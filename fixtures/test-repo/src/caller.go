package src

// Handler demonstrates a caller of UploadService.Retention for impact analysis.
type Handler struct{}

func (h Handler) Process() int {
	s := UploadService{}
	return s.Retention()
}
