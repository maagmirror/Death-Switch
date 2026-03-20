# Imagen con glibc (sqlite3 suele traer binarios precompilados para linux/amd64)
FROM node:20-bookworm-slim

WORKDIR /app

# Dependencias primero (mejor cache)
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# Código y assets estáticos
COPY . .

# Directorios que usa la app (también los crea al iniciar; útiles para volúmenes)
RUN mkdir -p data encrypted_data original_files tmp_uploads templates public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# package.json: "start": "node src/index.js"
CMD ["node", "src/index.js"]
