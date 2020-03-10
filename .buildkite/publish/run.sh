#!/bin/bash

set -ex

if [ "$DEVELOPMENT_ENVIRONMENT_COMMIT" ]; then
  git stash
  git checkout $DEVELOPMENT_ENVIRONMENT_COMMIT
fi

npm i -g pnpm@4.9.3
npm i -g yarn || echo "Ok"
yarn --version || echo "Ok"
pnpm i -g sqlite3 --unsafe-perm
pnpm i

pnpm run setup

cd prisma2/cli/prisma2
pnpm i sqlite3 --unsafe-perm
cd ../../..

pnpm run test

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

pnpm run publish-all