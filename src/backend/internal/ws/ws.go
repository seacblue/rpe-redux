// Minimal RFC 6455 server framing shared by the room listener and the editor
// bridge. Both speak text JSON over loopback, so the codec stays small while
// still handling masking, fragmentation, ping/pong, and close frames.

package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// Message limits, handshake constant, and frame opcodes for the room socket.
const (
	// A room create carries the full chart JSON before assets are streamed.
	// Large authored charts can be tens of megabytes, so the frame budget is
	// deliberately above the asset chunk size.
	maxMessage     = 64 << 20
	wsGUID         = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	writeTimeout   = 15 * time.Second
	readTimeout    = 75 * time.Second
	queueSize      = 64
	opcodeContinue = 0x0
	opcodeText     = 0x1
	opcodeClose    = 0x8
	opcodePing     = 0x9
	opcodePong     = 0xa
)

// ErrClosed reports a peer close frame.
var ErrClosed = errors.New("collaboration websocket closed")

// frame is one queued server frame. The writer goroutine owns the socket
// so a slow peer cannot block the room's broadcast path.
type frame struct {
	opcode  byte
	payload []byte
	// final asks the writer to close the connection after this frame drains.
	final bool
}

// Conn is one upgraded connection with a bounded outgoing queue.
type Conn struct {
	conn      net.Conn
	reader    *bufio.Reader
	out       chan frame
	done      chan struct{}
	closeOnce sync.Once
}

// newConn wraps an upgraded connection, starts its writer, and returns it.
func newConn(conn net.Conn, reader *bufio.Reader) *Conn {
	socket := &Conn{
		conn:   conn,
		reader: reader,
		out:    make(chan frame, queueSize),
		done:   make(chan struct{}),
	}
	go socket.writeLoop()
	return socket
}

// Upgrade performs the HTTP upgrade and returns the framed connection.
func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" || r.Header.Get("Sec-WebSocket-Version") != "13" {
		http.Error(w, "websocket upgrade required", http.StatusUpgradeRequired)
		return nil, errors.New("invalid websocket handshake")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket unsupported", http.StatusInternalServerError)
		return nil, errors.New("response writer cannot hijack")
	}
	conn, buffered, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	if _, err := fmt.Fprintf(
		buffered,
		"HTTP/1.1 101 Switching Protocols\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Accept: %s\r\n\r\n",
		accept,
	); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := buffered.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return newConn(conn, buffered.Reader), nil
}

// readFrame reads one masked client frame and returns its FIN bit, opcode, and
// unmasked payload.
func (w *Conn) readFrame() (bool, byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(w.reader, header); err != nil {
		return false, 0, nil, err
	}
	fin := header[0]&0x80 != 0
	opcode := header[0] & 0x0f
	if header[0]&0x70 != 0 {
		return false, 0, nil, errors.New("reserved websocket bits set")
	}
	masked := header[1]&0x80 != 0
	if !masked {
		return false, 0, nil, errors.New("client frames must be masked")
	}
	length := uint64(header[1] & 0x7f)
	switch length {
	case 126:
		extended := make([]byte, 2)
		if _, err := io.ReadFull(w.reader, extended); err != nil {
			return false, 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(extended))
	case 127:
		extended := make([]byte, 8)
		if _, err := io.ReadFull(w.reader, extended); err != nil {
			return false, 0, nil, err
		}
		length = binary.BigEndian.Uint64(extended)
	}
	if length > maxMessage {
		return false, 0, nil, errors.New("websocket message too large")
	}
	if opcode >= opcodeClose && (!fin || length > 125) {
		return false, 0, nil, errors.New("invalid websocket control frame")
	}
	mask := make([]byte, 4)
	if _, err := io.ReadFull(w.reader, mask); err != nil {
		return false, 0, nil, err
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(w.reader, payload); err != nil {
		return false, 0, nil, err
	}
	for index := range payload {
		payload[index] ^= mask[index%4]
	}
	return fin, opcode, payload, nil
}

// ReadMessage reassembles a complete text message and handles control frames
// inline.
func (w *Conn) ReadMessage() ([]byte, error) {
	var fragments []byte
	started := false
	for {
		fin, opcode, payload, err := w.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case opcodeClose:
			_ = w.writeControl(opcodeClose, payload)
			return nil, ErrClosed
		case opcodePing:
			if err := w.writeControl(opcodePong, payload); err != nil {
				return nil, err
			}
			continue
		case opcodePong:
			continue
		case opcodeText:
			if started {
				return nil, errors.New("interleaved websocket text frames")
			}
			started = true
			fragments = append(fragments, payload...)
		case opcodeContinue:
			if !started {
				return nil, errors.New("unexpected websocket continuation")
			}
			fragments = append(fragments, payload...)
		default:
			return nil, errors.New("unsupported websocket opcode")
		}
		if len(fragments) > maxMessage {
			return nil, errors.New("websocket message too large")
		}
		if fin {
			return fragments, nil
		}
	}
}

// writeLoop drains queued frames and owns every write to the connection.
func (w *Conn) writeLoop() {
	for {
		select {
		case <-w.done:
			return
		default:
		}
		select {
		case <-w.done:
			return
		case frame := <-w.out:
			if err := w.writeFrameNow(frame.opcode, frame.payload); err != nil {
				w.Close()
				return
			}
			if frame.final {
				w.Close()
				return
			}
		}
	}
}

// enqueue adds one frame without blocking the caller.
func (w *Conn) enqueue(opcode byte, payload []byte) error {
	select {
	case <-w.done:
		return ErrClosed
	default:
	}
	select {
	case w.out <- frame{opcode: opcode, payload: payload}:
		return nil
	case <-w.done:
		return ErrClosed
	default:
		return errors.New("websocket send queue is full")
	}
}

// writeFrameNow writes one unmasked server frame on the writer goroutine.
func (w *Conn) writeFrameNow(opcode byte, payload []byte) error {
	length := len(payload)
	header := make([]byte, 0, 10)
	header = append(header, 0x80|opcode)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length < 65536:
		header = append(header, 126, 0, 0)
		binary.BigEndian.PutUint16(header[len(header)-2:], uint16(length))
	default:
		header = append(header, 127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(header[len(header)-8:], uint64(length))
	}
	if err := w.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		return err
	}
	if _, err := w.conn.Write(header); err != nil {
		return err
	}
	if _, err := w.conn.Write(payload); err != nil {
		return err
	}
	return nil
}

// WriteText queues one text frame.
func (w *Conn) WriteText(payload []byte) error {
	return w.enqueue(opcodeText, payload)
}

// WriteTextWait queues one text frame, waiting for a queue slot when the
// bounded outgoing buffer is full. Closing the connection unblocks the wait.
// Streamed assets use this path so a large transfer applies backpressure
// without turning the room broadcast path into an unbounded memory queue.
func (w *Conn) WriteTextWait(payload []byte) error {
	return w.enqueueWait(opcodeText, payload)
}

// enqueueWait adds one frame after capacity becomes available or the socket
// closes. The caller is expected to use this only from an isolated stream
// goroutine, never from the room's synchronous broadcast path.
func (w *Conn) enqueueWait(opcode byte, payload []byte) error {
	select {
	case <-w.done:
		return ErrClosed
	default:
	}
	select {
	case w.out <- frame{opcode: opcode, payload: payload}:
		return nil
	case <-w.done:
		return ErrClosed
	}
}

// writeControl queues a control frame, truncating its payload to 125 bytes.
func (w *Conn) writeControl(opcode byte, payload []byte) error {
	if len(payload) > 125 {
		payload = payload[:125]
	}
	return w.enqueue(opcode, payload)
}

// ArmReadDeadline bounds one inbound message so a half-open peer becomes
// offline instead of occupying a slot forever.
func (w *Conn) ArmReadDeadline() {
	_ = w.conn.SetReadDeadline(time.Now().Add(readTimeout))
}

// CloseAfterFlush queues a close frame behind every message already accepted
// for this socket, then stops the writer and closes the connection.
func (w *Conn) CloseAfterFlush() {
	select {
	case <-w.done:
		return
	default:
	}
	select {
	case w.out <- frame{opcode: opcodeClose, payload: []byte{0x03, 0xe8}, final: true}:
	case <-w.done:
	default:
		w.Close()
	}
}

// Close asks the writer to stop and closes the connection once.
func (w *Conn) Close() {
	w.closeOnce.Do(func() {
		select {
		case w.out <- frame{opcode: opcodeClose, payload: []byte{0x03, 0xe8}}:
		default:
		}
		close(w.done)
		_ = w.conn.Close()
	})
}
