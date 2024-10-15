# Use an NVIDIA CUDA base image with Debian
FROM ubuntu:24.04

# Set DEBIAN_FRONTEND to noninteractive to avoid timezone configuration prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install curl and Node.js (version 20+) and NPM
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest && \
    rm -rf /var/lib/apt/lists/*

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

# Expose the port for the application
EXPOSE 6339

# Run the application within the virtual environment
CMD ["npx", "--yes", "next", "start", "-p", "6339"]
