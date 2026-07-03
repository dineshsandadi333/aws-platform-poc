Spring API

Build locally:

```bash
mvn -q -DskipTests package
docker build -t local-spring-api:latest .
docker run -p 8080:8080 local-spring-api:latest
```

Health: http://localhost:8080/actuator/health
API: http://localhost:8080/
