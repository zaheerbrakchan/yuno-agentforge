import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({ baseURL: `${BASE_URL}/api` })

export const agentsApi = {
  list: () => api.get('/agents/'),
  create: (data) => api.post('/agents/', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: (id) => api.delete(`/agents/${id}`),
  getTools: () => api.get('/agents/tools/available'),
}

export const workflowsApi = {
  list: () => api.get('/workflows/'),
  create: (data) => api.post('/workflows/', data),
  update: (id, data) => api.put(`/workflows/${id}`, data),
  delete: (id) => api.delete(`/workflows/${id}`),
  getTemplates: () => api.get('/workflows/templates'),
  run: (id, data) => api.post(`/workflows/${id}/run`, data),
  listSessions: () => api.get('/workflows/sessions/list'),
  getMessages: (id, sessionId) => api.get(`/workflows/${id}/messages`, { params: { session_id: sessionId } }),
  deleteSession: (sessionId) => api.delete(`/workflows/sessions/${sessionId}`),
  deleteSessionLegacy: (id, sessionId) => api.delete(`/workflows/${id}/sessions/${sessionId}`),
  deleteRun: (runId) => api.delete(`/workflows/runs/${runId}`),
}

export const statsApi = {
  get: () => api.get('/stats'),
}

export const paymentsApi = {
  list: () => api.get('/payments/'),
  create: (data) => api.post('/payments/', data),
  delete: (id) => api.delete(`/payments/${id}`),
}

export const channelsApi = {
  list: () => api.get('/channels/'),
  connectTelegram: (data) => api.post('/channels/telegram', data),
  updateTelegram: (id, data) => api.put(`/channels/telegram/${id}`, data),
  deleteTelegram: (id) => api.delete(`/channels/telegram/${id}`),
}

export default api
