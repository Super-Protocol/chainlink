FROM smartcontract/chainlink:2.27.0

USER root

ARG NODE_VERSION=20

ENV NVM_DIR=/root/.nvm

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
RUN bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"

COPY scripts /scripts

RUN cd /scripts/secrets && PATH=$PATH:/root/.nvm/versions/node/v$NODE_VERSION/bin/ npm ci
