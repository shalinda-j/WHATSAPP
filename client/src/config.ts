import axios from 'axios';

// Get API URL from env or default to relative path (for same-domain deployment)
const API_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add token to requests if available
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});
