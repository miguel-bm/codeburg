package api

// sendTerminalInput writes a terminal message followed by Enter.
// PTY-backed CLIs expect carriage return for submit semantics.
func (s *Server) sendTerminalInput(sessionID, content string) error {
	return s.sessions.runtime.Write(sessionID, []byte(content+"\r"))
}
