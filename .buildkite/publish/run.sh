#!/bin/bash

set -ex

if [ "$DEVELOPMENT_ENVIRONMENT_COMMIT" ]; then
  git stash
  git checkout $DEVELOPMENT_ENVIRONMENT_COMMIT
fi

npm i -g node-gyp
npm i -g pnpm@4.9.3
npm i -g yarn || echo "Ok"
yarn --version || echo "Ok"
pnpm i

pnpm run setup

pnpm run test


echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc


pnpm run publish-all