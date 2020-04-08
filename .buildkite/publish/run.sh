#!/bin/bash

set -ex

if [ "$DEVELOPMENT_ENVIRONMENT_COMMIT" ]; then
  git stash
  git checkout $DEVELOPMENT_ENVIRONMENT_COMMIT
fi

npm i -g pnpm
npm i -g yarn || echo "Ok"
yarn --version || echo "Ok"
pnpm i --no-prefer-frozen-lockfile

pnpm run setup

cd prisma/cli/prisma2
pnpm i sqlite3@4.1.1 --unsafe-perm
cd ../../..

pnpm run test

pnpm run publish-all