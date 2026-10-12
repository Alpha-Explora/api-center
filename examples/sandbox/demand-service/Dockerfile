FROM node:24-alpine3.22

WORKDIR /workspace
COPY package.json package-lock.json turbo.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY examples/sandbox/demand-service/ ./examples/sandbox/demand-service/

RUN npm ci
RUN npm run build --workspace @alpha-explora/apicenter-contracts \
  && npm run build --workspace @alpha-explora/apicenter-sdk

WORKDIR /workspace/examples/sandbox/demand-service

EXPOSE 4100
CMD ["npm", "run", "start"]
