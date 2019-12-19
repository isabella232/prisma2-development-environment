#!/bin/bash

set -ex

npm i -g pnpm
pnpm i

pnpm run setup

pnpm run test
