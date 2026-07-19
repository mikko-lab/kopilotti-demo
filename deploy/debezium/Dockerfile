FROM quay.io/debezium/connect:3.6

USER root
ARG JMX_EXPORTER_VERSION=1.0.1
ARG JMX_EXPORTER_SHA256=7d61f737fd661610ccc14aea79764faa1ea94a340cbc8f0029b3d2edea3d80c1
RUN curl --fail --silent --show-error --location \
      --output /opt/jmx_prometheus_javaagent.jar \
      "https://repo.maven.apache.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/${JMX_EXPORTER_VERSION}/jmx_prometheus_javaagent-${JMX_EXPORTER_VERSION}.jar" \
    && echo "${JMX_EXPORTER_SHA256}  /opt/jmx_prometheus_javaagent.jar" | sha256sum --check --strict \
    && chmod 0444 /opt/jmx_prometheus_javaagent.jar
COPY --chmod=0444 deploy/monitoring/debezium-jmx.yml /opt/debezium-jmx.yml
USER kafka

ENV KAFKA_OPTS="-javaagent:/opt/jmx_prometheus_javaagent.jar=9404:/opt/debezium-jmx.yml"
EXPOSE 8083 9404
