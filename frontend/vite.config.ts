import { defineConfig } from 'vite';
export default defineConfig({server:{proxy:{'/api':{target:'http://backend:5000',changeOrigin:false},'/socket.io':{target:'http://backend:5000',ws:true}}}});
