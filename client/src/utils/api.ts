import axios from 'axios';

// Since we proxy or serve from same origin, base URL is relative
// Unless we are dev mode and need to point to backend.
// In dev, we can use Vite proxy.
const api = axios.create({
    baseURL: '/api'
});

api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
