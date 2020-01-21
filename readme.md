# Prisma 2 Development Environment

```
npm install -g pnpm
pnpm install
pnpm run setup
```

### [Developing Prisma Client JS](https://github.com/prisma/prisma-client-js/tree/master/packages/photon#contributing)

### Developing Prisma Migrate

1. `cd lift/fixtures/blog`
2. `ts-node ../../src/bin.ts up`

### Developing `prisma2 init` Command

1. `cd prisma2/cli/introspection`
2. `mkdir test && cd test`
3. `ts-node ../src/bin.ts`

### Developing `prisma2` CLI

1. `cd prisma2/cli/prisma2`
2. `mkdir test && cd test`
3. `ts-node ../src/bin.ts generate`
