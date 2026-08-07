package src

// UploadService handles tenant-aware upload retention policy.
type UploadService struct{}

func (s UploadService) Retention() int { return 7 }
