FROM eclipse-temurin:17-jdk-jammy

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip wget ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ========== Android SDK Setup ==========
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0

# Download and install Android command-line tools
RUN mkdir -p $ANDROID_HOME/cmdline-tools && \
    curl -o /tmp/cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && \
    unzip /tmp/cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools && \
    mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && \
    rm /tmp/cmdline-tools.zip

# Accept licenses and install SDK packages
RUN yes | sdkmanager --licenses && \
    sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# ========== Gradle Setup ==========
ENV GRADLE_VERSION=8.4
ENV GRADLE_HOME=/opt/gradle
ENV PATH=$PATH:$GRADLE_HOME/bin

RUN curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip && \
    unzip /tmp/gradle.zip -d /opt && \
    mv /opt/gradle-${GRADLE_VERSION} $GRADLE_HOME && \
    rm /tmp/gradle.zip

# ========== Debug Keystore ==========
RUN keytool -genkey -v \
    -keystore /root/debug.keystore \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US"

# ========== Application Setup ==========
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Generate Gradle wrapper in a clean temp dir (avoids evaluating template build.gradle)
RUN mkdir -p /tmp/gradle-init && \
    cd /tmp/gradle-init && \
    echo "" > settings.gradle && \
    gradle wrapper --gradle-version ${GRADLE_VERSION} --no-daemon && \
    cp -r /tmp/gradle-init/gradle /app/template/ && \
    cp /tmp/gradle-init/gradlew /app/template/ && \
    chmod +x /app/template/gradlew && \
    rm -rf /tmp/gradle-init

# Pre-download Gradle distribution via wrapper (so first build is faster)
RUN cd /tmp && mkdir -p gradle-warmup && cd gradle-warmup && \
    echo "" > settings.gradle && \
    cp -r /app/template/gradle . && \
    cp /app/template/gradlew . && \
    ./gradlew --version --no-daemon && \
    cd / && rm -rf /tmp/gradle-warmup

# Create required directories
RUN mkdir -p /app/builds /app/outputs

EXPOSE 3000

CMD ["node", "src/server.js"]
