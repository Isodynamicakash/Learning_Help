const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  chat: (user_id, message) => post("/chat", { user_id, message }),
  getChatProfile: (user_id) => get(`/chat/profile/${user_id}`),
  recommend: (user_id, query, top_k = 5) => post("/recommend", { user_id, query, top_k }),
  generatePath: (user_id) => post("/path/generate", { user_id }),
  adaptPath: (user_id, path_id, course_id, feedback) =>
    post("/path/adapt", { user_id, path_id, course_id, feedback }),
  explain: (user_id, course_id) => post("/explain", { user_id, course_id }),
  updateProgress: (user_id, course_id, status, feedback = null) =>
    post("/progress", { user_id, course_id, status, feedback }),
  getProgress: (user_id) => get(`/progress/${user_id}`),
  getSkills: (user_id) => get(`/progress/${user_id}/skills`),
};