#  ─── Build stage ───────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /app
COPY gradle gradle
COPY gradlew build.gradle.kts settings.gradle.kts gradle.properties ./
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies

COPY src ./src
RUN ./gradlew --no-daemon buildFatJar

#  ─── Runtime stage ─────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
RUN addgroup -S cointrack && adduser -S cointrack -G cointrack
USER cointrack

COPY --from=build /app/build/libs/cointrack-api.jar app.jar

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
