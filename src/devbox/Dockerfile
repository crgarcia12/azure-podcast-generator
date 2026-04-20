FROM mcr.microsoft.com/devcontainers/typescript-node:20

USER root

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        apt-transport-https \
        ca-certificates \
        curl \
        gpg \
        lsb-release \
        python3-pip \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && curl -fsSL https://aka.ms/install-azd.sh | bash \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
    && chmod a+r /etc/apt/keyrings/microsoft.gpg \
    && . /etc/os-release \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/${VERSION_ID}/prod ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/microsoft-prod.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-sdk-9.0 \
    && npm install -g typescript-language-server \
    && pip3 install --no-cache-dir mkdocs mkdocs-material \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY start-devbox.sh /usr/local/bin/start-devbox.sh

RUN chmod 755 /usr/local/bin/start-devbox.sh

ENV DEVBOX_WORKSPACE_ROOT=/workspace \
    DEVBOX_REPOSITORY_URL=https://github.com/crgarcia12/azure-podcast-generator.git \
    DEVBOX_REPOSITORY_BRANCH=main \
    DEVBOX_REPOSITORY_PATH=/workspace/azure-podcast-generator \
    HOME=/workspace/home \
    SHELL=/bin/bash

USER node
WORKDIR /workspace

CMD ["/bin/bash", "/usr/local/bin/start-devbox.sh"]
