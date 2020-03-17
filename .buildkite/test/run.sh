#!/bin/bash

set -ex

npm i -g pnpm@4.9.3
pnpm i

pnpm run setup

cd prisma2/cli/prisma2
pnpm i sqlite3@4.1.1 --unsafe-perm
cd ../../..

pnpm run test
