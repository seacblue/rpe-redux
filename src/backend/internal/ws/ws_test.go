// Tests for bounded WebSocket writes used by streamed collaboration assets.

package ws

import (
	"bufio"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// blockingWriteConn keeps the writer goroutine on its first frame until the
// test explicitly releases it, making the bounded outgoing queue deterministic.
type blockingWriteConn struct {
	started     chan struct{}
	release     chan struct{}
	startOnce   sync.Once
	releaseOnce sync.Once
}

func (c *blockingWriteConn) Read([]byte) (int, error) { return 0, io.EOF }

func (c *blockingWriteConn) Write(payload []byte) (int, error) {
	c.startOnce.Do(func() { close(c.started) })
	<-c.release
	return len(payload), nil
}

func (c *blockingWriteConn) Close() error {
	c.releaseOnce.Do(func() { close(c.release) })
	return nil
}

func (c *blockingWriteConn) LocalAddr() net.Addr              { return netAddr{} }
func (c *blockingWriteConn) RemoteAddr() net.Addr             { return netAddr{} }
func (c *blockingWriteConn) SetDeadline(time.Time) error      { return nil }
func (c *blockingWriteConn) SetReadDeadline(time.Time) error  { return nil }
func (c *blockingWriteConn) SetWriteDeadline(time.Time) error { return nil }

// netAddr is the minimal net.Addr implementation required by net.Conn.
type netAddr struct{}

func (netAddr) Network() string { return "test" }
func (netAddr) String() string  { return "test" }

func TestWriteTextWaitBackpressuresInsteadOfDropping(t *testing.T) {
	raw := &blockingWriteConn{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	socket := newConn(raw, bufio.NewReader(nil))
	defer socket.Close()

	if err := socket.WriteText([]byte("first")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-raw.started:
	case <-time.After(time.Second):
		t.Fatal("writer did not start")
	}
	for index := 0; index < queueSize; index++ {
		if err := socket.WriteText([]byte("queued")); err != nil {
			t.Fatalf("queue write %d: %v", index, err)
		}
	}

	completed := make(chan error, 1)
	go func() { completed <- socket.WriteTextWait([]byte("backpressured")) }()
	select {
	case err := <-completed:
		t.Fatalf("backpressured write returned before capacity: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	raw.releaseOnce.Do(func() { close(raw.release) })
	select {
	case err := <-completed:
		if err != nil {
			t.Fatalf("backpressured write failed after capacity returned: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("backpressured write did not complete")
	}
}
