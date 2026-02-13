package api

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func isProtectedProjectPath(relPath string) bool {
	slashPath := filepath.ToSlash(relPath)
	return slashPath == ".git" || strings.HasPrefix(slashPath, ".git/")
}

func normalizeRelativePath(raw string, allowEmpty bool) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("path is required")
	}
	if filepath.IsAbs(p) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}
	clean := filepath.Clean(p)
	if clean == "." {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path traversal is not allowed")
	}
	return clean, nil
}

func safeJoin(basePath, relPath string) (string, error) {
	baseAbs, err := filepath.Abs(basePath)
	if err != nil {
		return "", fmt.Errorf("invalid base path")
	}
	baseResolved, err := filepath.EvalSymlinks(baseAbs)
	if err != nil {
		return "", fmt.Errorf("invalid base path")
	}

	targetAbs := baseResolved
	if relPath != "" {
		targetAbs = filepath.Join(baseResolved, relPath)
	}
	targetAbs, err = filepath.Abs(targetAbs)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}

	resolvedTarget, err := resolvePathWithResolvedParent(targetAbs)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}

	rel, err := filepath.Rel(baseResolved, resolvedTarget)
	if err != nil {
		return "", fmt.Errorf("invalid path")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes project root")
	}
	return resolvedTarget, nil
}

// resolvePathWithResolvedParent resolves symlinks for an existing path, or for the
// nearest existing parent when the target does not exist yet.
func resolvePathWithResolvedParent(targetAbs string) (string, error) {
	targetAbs = filepath.Clean(targetAbs)
	current := targetAbs

	for {
		if _, err := os.Lstat(current); err == nil {
			resolvedCurrent, err := filepath.EvalSymlinks(current)
			if err != nil {
				return "", err
			}
			if current == targetAbs {
				return resolvedCurrent, nil
			}
			rest, err := filepath.Rel(current, targetAbs)
			if err != nil {
				return "", err
			}
			return filepath.Clean(filepath.Join(resolvedCurrent, rest)), nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}

		parent := filepath.Dir(current)
		if parent == current {
			return "", os.ErrNotExist
		}
		current = parent
	}
}

func listProjectFiles(projectRoot, relPath string, depth int) ([]projectFileEntry, error) {
	rootAbs, err := safeJoin(projectRoot, relPath)
	if err != nil {
		return nil, err
	}

	out := make([]projectFileEntry, 0, 64)
	if err := walkProjectFiles(rootAbs, relPath, depth, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func walkProjectFiles(absDir, relDir string, depth int, out *[]projectFileEntry) error {
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		relChild := entry.Name()
		if relDir != "" {
			relChild = filepath.Join(relDir, entry.Name())
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fileType := "file"
		if entry.IsDir() {
			fileType = "dir"
		}

		*out = append(*out, projectFileEntry{
			Name:    entry.Name(),
			Path:    filepath.ToSlash(relChild),
			Type:    fileType,
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})

		if depth > 1 && entry.IsDir() {
			if err := walkProjectFiles(filepath.Join(absDir, entry.Name()), relChild, depth-1, out); err != nil {
				continue
			}
		}
	}

	return nil
}
