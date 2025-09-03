FROM smartcontract/chainlink:2.27.0

USER root

ARG NODE_VERSION=22.18.0

ENV NVM_DIR=/root/.nvm
ENV SP_SECRETS_DIR=/sp/secrets
ENV PATH=$PATH:/root/.nvm/versions/node/v$NODE_VERSION/bin/

RUN apt-get update
RUN apt-get install -y --no-install-recommends gettext jq

# postgres
RUN apt-get install -y --no-install-recommends postgresql
RUN ln -s /usr/lib/postgresql/17/bin/* /usr/local/bin/

# RUN rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/lib/postgresql/data && chown -R postgres:postgres /var/lib/postgresql

# node
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
RUN bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"

COPY scripts /scripts
COPY data-feed-generator/templates /job-templates

RUN cd /scripts/secrets && npm ci --no-audit --no-fund --omit=optional
