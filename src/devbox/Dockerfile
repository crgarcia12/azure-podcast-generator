FROM mcr.microsoft.com/devcontainers/typescript-node:20

USER root

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        apt-transport-https \
        ca-certificates \
        curl \
        gh \
        lsb-release \
        python3-pip \
    && curl -sL https://aka.ms/InstallAzureCLIDeb | bash \
    && curl -fsSL https://aka.ms/install-azd.sh | bash \
    && curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet \
    && rm /tmp/dotnet-install.sh \
    && npm install -g @github/copilot typescript-language-server \
    && pip3 install --no-cache-dir --break-system-packages mkdocs mkdocs-material \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY start-devbox.sh /usr/local/bin/start-devbox.sh

RUN chmod 755 /usr/local/bin/start-devbox.sh

ENV DEVBOX_WORKSPACE_ROOT=/workspace \
    DEVBOX_REPOSITORY_URL=https://github.com/crgarcia12/azure-podcast-generator.git \
    DEVBOX_REPOSITORY_BRANCH=main \
    DEVBOX_REPOSITORY_PATH=/workspace/azure-podcast-generator \
    DOTNET_ROOT=/usr/share/dotnet \
    HOME=/workspace/home \
    SHELL=/bin/bash

USER node
WORKDIR /workspace

CMD ["/bin/bash", "/usr/local/bin/start-devbox.sh"]
