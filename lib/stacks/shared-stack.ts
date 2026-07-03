import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { PlatformConfig } from '../config/environment';

export interface SharedStackProps extends cdk.StackProps {
  readonly config: PlatformConfig;
}

export class SharedStack extends cdk.Stack {
  readonly artifactsBucket: s3.Bucket;
  readonly springApiRepository: ecr.Repository;
  readonly pythonWorkerRepository: ecr.Repository;
  readonly key: kms.Key;

  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);

    const { projectName, stage } = props.config;

    this.key = new kms.Key(this, 'PlatformKey', {
      alias: `alias/${projectName}/${stage}/platform`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.springApiRepository = this.createRepository('SpringApiRepository', `${projectName}/${stage}/spring-api`);
    this.pythonWorkerRepository = this.createRepository('PythonWorkerRepository', `${projectName}/${stage}/python-worker`);

    new cdk.CfnOutput(this, 'SpringApiRepositoryUri', {
      value: this.springApiRepository.repositoryUri,
    });

    new cdk.CfnOutput(this, 'PythonWorkerRepositoryUri', {
      value: this.pythonWorkerRepository.repositoryUri,
    });
  }

  private createRepository(id: string, repositoryName: string): ecr.Repository {
    return new ecr.Repository(this, id, {
      repositoryName,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: this.key,
      lifecycleRules: [
        {
          maxImageCount: 20,
          rulePriority: 1,
          description: 'Keep the most recent application images.',
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
