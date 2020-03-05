# Prisma 2 Development Environment

```console
npm install -g pnpm
pnpm install
pnpm run setup
```

Note for Windows: Use the latest version of [Git Bash](https://gitforwindows.org/)

### [Developing Prisma Client JS](https://github.com/prisma/prisma-client-js/tree/master/packages/photon#contributing)

### Developing Prisma Migrate

1. `cd migrate/fixtures/blog`
2. `ts-node ../../src/bin.ts up`

### Developing `prisma2 init` Command

1. `cd prisma2/cli/introspection`
2. `mkdir test && cd test`
3. `ts-node ../src/bin.ts`

### Developing `prisma2` CLI

1. `cd prisma2/cli/prisma2`
2. `mkdir test && cd test`
3. `ts-node ../src/bin.ts generate`

### How to update all binaries
```bash
cd prisma2/cli/sdk
rm *engine*
pnpm run download
cd ../prisma2
rm *engine*
pnpm run download
cd ../../../prisma-client-js/packages/photon
rm *engine*
pnpm run download
cd ../engine-core
pnpm run download
```
