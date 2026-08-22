FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000
# O build emite dist/src/main.js, e não dist/main.js: o tsconfig inclui arquivos
# fora de src/ (vitest.config.ts, scripts/), então o rootDir comum passa a ser a
# raiz do projeto e o dist espelha essa estrutura.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
