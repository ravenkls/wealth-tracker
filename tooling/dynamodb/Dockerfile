FROM amazon/dynamodb-local@sha256:ff89bd48ff32cd8d9be5fee8873b65b8854dc408f1afe881be6eb00247bc0dab
USER root
RUN mkdir -p /data && chown dynamodblocal:dynamodblocal /data
USER dynamodblocal
