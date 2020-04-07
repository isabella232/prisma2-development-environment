#!/bin/bash

set -ex

npm i -g pnpm
pnpm i --frozen-lockfile=false

pnpm run setup

cd prisma/cli/prisma2
pnpm i --frozen-lockfile=false sqlite3@4.1.1 --unsafe-perm
cd ../../..

pnpm run test
