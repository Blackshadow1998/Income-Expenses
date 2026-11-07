package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"income-expenses/internal/httpx"
)

// Each user edits their own item list ("รายการ"); GET /api/categories returns it per category.

func decodeName(w http.ResponseWriter, r *http.Request, in any, name *string) bool {
	if err := json.NewDecoder(r.Body).Decode(in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return false
	}
	*name = strings.TrimSpace(*name)
	if *name == "" || len([]rune(*name)) > 60 {
		httpx.BadRequest(w, "ชื่อรายการต้องยาว 1–60 ตัวอักษร")
		return false
	}
	return true
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

func (a *API) createSubcategory(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CategoryID int64  `json:"category_id"`
		Name       string `json:"name"`
	}
	if !decodeName(w, r, &in, &in.Name) {
		return
	}
	uid := userID(r)
	res, err := a.db.ExecContext(r.Context(), `
		INSERT INTO subcategories (user_id, category_id, name, sort_order)
		SELECT ?1, c.id, ?3, COALESCE((SELECT MAX(sort_order) FROM subcategories WHERE user_id = ?1 AND category_id = c.id), 0) + 1
		FROM categories c WHERE c.id = ?2`, uid, in.CategoryID, in.Name)
	if isUniqueViolation(err) {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "มีรายการชื่อนี้ในหมวดนี้แล้ว"})
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.BadRequest(w, "unknown category_id")
		return
	}
	id, _ := res.LastInsertId()
	httpx.WriteJSON(w, http.StatusCreated, Subcategory{ID: id, Name: in.Name})
}

func (a *API) renameSubcategory(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeName(w, r, &in, &in.Name) {
		return
	}
	res, err := a.db.ExecContext(r.Context(),
		`UPDATE subcategories SET name = ? WHERE id = ? AND user_id = ?`, in.Name, id, userID(r))
	if isUniqueViolation(err) {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "มีรายการชื่อนี้ในหมวดนี้แล้ว"})
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, Subcategory{ID: id, Name: in.Name})
}

// deleteSubcategory removes an item; transactions that used it keep their category and become "ไม่ระบุ".
func (a *API) deleteSubcategory(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	uid := userID(r)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	cleared, err := tx.ExecContext(r.Context(),
		`UPDATE transactions SET subcategory_id = NULL WHERE subcategory_id = ? AND user_id = ?`, id, uid)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM subcategories WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	n, _ := cleared.RowsAffected()
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"cleared_transactions": n})
}
