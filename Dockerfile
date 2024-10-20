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

# Define build arguments and environment variables
ENV DISABLE_API_PROXY=true

# Install Node.js dependencies and build the Next.js application
RUN npm install --include=dev && \
    npx --yes next build

# Only expose the Next.js port for external access
EXPOSE 6339

CMD ["npx", "--yes", "next", "start", "-p", "6339"]
