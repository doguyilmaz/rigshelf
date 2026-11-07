ARG BUN_IMAGE=oven/bun:1.4.4-slim
FROM ${BUN_IMAGE} AS build
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --backend=copyfile
COPY . .
RUN bun run package && mkdir /packaged && tar -xzf .local/releases/rigshelf-*-portable.tar.gz -C /packaged

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=bun:bun /packaged/ /app/
RUN mkdir /data && chown bun:bun /data
ENV RIGSHELF_DATA_DIR=/data
USER bun
ENTRYPOINT ["/app/bin/rigshelf"]
CMD ["--help"]
