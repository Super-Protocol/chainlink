FROM node:22 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build

RUN npm ci --only=production --no-audit --no-fund


FROM node:22

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/main.js"]
