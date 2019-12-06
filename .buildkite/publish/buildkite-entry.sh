echo "BUILDKITE_TAG"
echo $BUILDKITE_TAG

buildkite-agent pipeline upload .buildkite/publish/publish.yml