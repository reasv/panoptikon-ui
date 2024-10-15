# Use the Ubuntu 24.04 base image
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages: curl, Nginx, gettext (for envsubst), Node.js, and npm
RUN apt-get update && \
    apt-get install -y curl nginx gettext && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest && \
    rm -rf /var/lib/apt/lists/*

# Create Nginx configuration template with a placeholder for PANOPTIKON_API_URL
RUN echo 'events {}' > /etc/nginx/nginx.conf.template && \
    echo 'http {' >> /etc/nginx/nginx.conf.template && \
    echo '    server {' >> /etc/nginx/nginx.conf.template && \
    echo '        listen 6342;' >> /etc/nginx/nginx.conf.template && \
    echo '        location / {' >> /etc/nginx/nginx.conf.template && \
    echo '            proxy_pass http://${PANOPTIKON_API_URL};' >> /etc/nginx/nginx.conf.template && \
    echo '            proxy_set_header Host $host;' >> /etc/nginx/nginx.conf.template && \
    echo '            proxy_set_header X-Real-IP $remote_addr;' >> /etc/nginx/nginx.conf.template && \
    echo '            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' >> /etc/nginx/nginx.conf.template && \
    echo '            proxy_set_header X-Forwarded-Proto $scheme;' >> /etc/nginx/nginx.conf.template && \
    echo '        }' >> /etc/nginx/nginx.conf.template && \
    echo '    }' >> /etc/nginx/nginx.conf.template && \
    echo '}' >> /etc/nginx/nginx.conf.template

# Create the application directory and a non-root user
RUN mkdir /app && \
    adduser --disabled-password --gecos '' appuser && \
    chown -R appuser /app

# Set the working directory
WORKDIR /app

# Copy the application code into the container
COPY . /app

# Change ownership of the application directory to the non-root user
RUN chown -R appuser /app

# Embed the start script as root (before switching to appuser)
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'envsubst "\$PANOPTIKON_API_URL" < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf' >> /start.sh && \
    echo 'nginx &' >> /start.sh && \
    echo 'npx --yes next start -p 6339' >> /start.sh && \
    chmod +x /start.sh

# Define build arguments and environment variables
ARG RESTRICTED_MODE
ARG INFERENCE_API_URL
ARG PANOPTIKON_API_URL
ENV RESTRICTED_MODE=${RESTRICTED_MODE}
ENV INFERENCE_API_URL=${INFERENCE_API_URL}
ENV PANOPTIKON_API_URL=${PANOPTIKON_API_URL}

# Install Node.js dependencies and build the Next.js application
RUN npm install --include=dev && \
    npx --yes next build

# Only expose the Next.js port for external access
EXPOSE 6339

# Run the start script to launch Nginx and Next.js
CMD ["/start.sh"]
