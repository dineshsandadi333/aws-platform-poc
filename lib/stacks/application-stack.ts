import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PlatformConfig } from '../config/environment';
import { NetworkingStack } from './networking-stack';
import { SharedStack } from './shared-stack';

export interface ApplicationStackProps extends cdk.StackProps {
  readonly config: PlatformConfig;
  readonly shared: SharedStack;
  readonly networking: NetworkingStack;
}

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const { config, networking, shared } = props;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: networking.vpc,
      clusterName: `${config.projectName}-${config.stage}`,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    const apiLogGroup = new logs.LogGroup(this, 'SpringApiLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'SpringApiServiceSecurityGroup', {
      vpc: networking.vpc,
      description: 'Security group for the Spring API ECS service.',
      allowAllOutbound: true,
    });

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'SpringApiService', {
      cluster,
      desiredCount: 2,
      cpu: 512,
      memoryLimitMiB: 1024,
      publicLoadBalancer: true,
      assignPublicIp: false,
      circuitBreaker: {
        rollback: true,
      },
      minHealthyPercent: 100,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(shared.springApiRepository, config.springApiImageTag),
        containerName: 'spring-api',
        containerPort: 8080,
        environment: {
          AWS_REGION: cdk.Stack.of(this).region,
          STAGE: config.stage,
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'spring-api',
          logGroup: apiLogGroup,
        }),
      },
      securityGroups: [serviceSecurityGroup],
    });

    api.targetGroup.configureHealthCheck({
      path: '/actuator/health',
      healthyHttpCodes: '200-399',
    });

    api.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 6,
    }).scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
    });

    const deadLetterQueue = new sqs.Queue(this, 'WorkerDeadLetterQueue', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: shared.key,
      retentionPeriod: cdk.Duration.days(14),
    });

    const workQueue = new sqs.Queue(this, 'WorkerQueue', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: shared.key,
      visibilityTimeout: cdk.Duration.seconds(90),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: deadLetterQueue,
      },
    });

    const worker = new lambda.Function(this, 'PythonWorker', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        STAGE: config.stage,
      },
      code: lambda.Code.fromInline(`
import json

def handler(event, context):
    for record in event.get("Records", []):
        body = record.get("body", "{}")
        print(json.dumps({"message": "processed worker message", "body": body}))
    return {"ok": True}
`),
    });

    worker.addEventSource(
      new lambdaEventSources.SqsEventSource(workQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    const apiGateway = new apigateway.RestApi(this, 'PlatformApi', {
      restApiName: `${config.projectName}-${config.stage}`,
      deployOptions: {
        stageName: config.stage,
        tracingEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    apiGateway.root.addProxy({
      defaultIntegration: new apigateway.HttpIntegration(`http://${api.loadBalancer.loadBalancerDnsName}/{proxy}`, {
        httpMethod: 'ANY',
        proxy: true,
        options: {
          requestParameters: {
            'integration.request.path.proxy': 'method.request.path.proxy',
          },
        },
      }),
      defaultMethodOptions: {
        requestParameters: {
          'method.request.path.proxy': true,
        },
      },
    });

    new cdk.CfnOutput(this, 'SpringApiLoadBalancerDnsName', {
      value: api.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'PlatformApiUrl', {
      value: apiGateway.url,
    });

    new cdk.CfnOutput(this, 'WorkerQueueUrl', {
      value: workQueue.queueUrl,
    });
  }
}
