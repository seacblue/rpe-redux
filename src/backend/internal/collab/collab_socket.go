// Room-specific attachment state layered on the shared websocket codec.

package collab

import "rperedux/server/internal/ws"

// collabSocket adds the room rate-limit identity, failed-join counter, and
// negotiated transport capabilities to a framed connection. Only the reader
// goroutine touches joinFailures; binaryChunks is set by the handshake before
// the socket attaches to a room.
type collabSocket struct {
	*ws.Conn
	joinFailures int
	clientKey    string
	binaryChunks bool
	chartChunks  bool
}
