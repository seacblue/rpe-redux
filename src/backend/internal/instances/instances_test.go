// Tests for the readable frontend port carried by instance and occupancy data.
package instances

import "testing"

func TestRegisterReportsFrontendPort(t *testing.T) {
	hub := NewHub()
	snapshot := hub.Register("first", "RPE Redux", 0, 4173)
	if snapshot.FrontendPort != 4173 {
		t.Fatalf("frontend port = %d, want 4173", snapshot.FrontendPort)
	}
}

func TestOccupancyConflictReportsOwnerFrontendPort(t *testing.T) {
	hub := NewHub()
	hub.Register("first", "RPE Redux", 0, 4173)
	hub.Register("second", "RPE Redux", 0, 4174)

	if _, acquired := hub.Acquire("library:chart", "first", "RPE Redux", "Chart", 4173); !acquired {
		t.Fatal("the first instance could not acquire the document")
	}
	owner, acquired := hub.Acquire("library:chart", "second", "RPE Redux", "Chart", 4174)
	if acquired {
		t.Fatal("the second instance acquired a document owned by the first")
	}
	if owner.ID != "first" {
		t.Fatalf("owner id = %q, want first", owner.ID)
	}
	if owner.FrontendPort != 4173 {
		t.Fatalf("owner frontend port = %d, want 4173", owner.FrontendPort)
	}
}
