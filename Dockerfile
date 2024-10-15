# Use the base image as before
FROM ubuntu:24.04

# Set DEBIAN_FRONTEND to noninteractive to avoid timezone configuration prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install curl, Node.js (version 20+), npm, and Nginx
RUN apt-get update && \
    apt-get install -y curl nginx && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest && \
    rm -rf /var/lib/apt/lists/*

# Create Nginx configuration
RUN echo 'events {}' > /etc/nginx/nginx.conf && \
    echo 'http {' >> /etc/nginx/nginx.conf && \
    echo '    server {' >> /etc/nginx/nginx.conf && \
    echo '        listen 6342;' >> /etc/nginx/nginx.conf && \
    echo '        location / {' >> /etc/nginx/nginx.conf && \
    echo '            proxy_pass http://${PANOPTIKON_API_URL};' >> /etc/nginx/nginx.conf && \
    echo '            proxy_set_header Host $host;' >> /etc/nginx/nginx.conf && \
    echo '            proxy_set_header X-Real-IP $remote_addr;' >> /etc/nginx/nginx.conf && \
    echo '            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' >> /etc/nginx/nginx.conf && \
    echo '            proxy_set_header X-Forwarded-Proto $scheme;' >> /etc/nginx/nginx.conf && \
    echo '        }' >> /etc/nginx/nginx.conf && \
    echo '    }' >> /etc/nginx/nginx.conf && \
    echo '}' >> /etc/nginx/nginx.conf

# Create a directory for the application and add a non-root user
RUN mkdir /app && \
    adduser --disabled-password --gecos '' appuser && \
    chown -R appuser /app

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container
COPY . /app

# Change ownership of app directory to the new user
RUN chown -R appuser /app

# Switch to the app user
USER appuser

# Define build arguments and environment variables
ARG RESTRICTED_MODE
ARG INFERENCE_API_URL
ARG PANOPTIKON_API_URL
ENV RESTRICTED_MODE=${RESTRICTED_MODE}
ENV INFERENCE_API_URL=${INFERENCE_API_URL}
ENV PANOPTIKON_API_URL=${PANOPTIKON_API_URL}

# Set up Node.js project and build Next.js application
RUN npm install --include=dev && \
    npx --yes next build

# Embed the start script
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'nginx -g "daemon off;" &' >> /start.sh && \
    echo 'npx --yes next start -p 6339' >> /start.sh && \
    chmod +x /start.sh

# Only expose the Next.js port for external access
EXPOSE 6339

# Run the start script to launch Nginx and Next.js
CMD ["/start.sh"]
