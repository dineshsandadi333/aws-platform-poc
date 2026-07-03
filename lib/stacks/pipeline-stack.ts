import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { PlatformConfig } from '../config/environment';
import { SharedStack } from './shared-stack';

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: PlatformConfig;
  readonly shared: SharedStack;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config, shared } = props;

    const synthProject = new codebuild.PipelineProject(this, 'SynthProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      environmentVariables: {
        PROJECT_NAME: { value: config.projectName },
        STAGE: { value: config.stage },
        SPRING_API_REPOSITORY_URI: { value: shared.springApiRepository.repositoryUri },
        PYTHON_WORKER_REPOSITORY_URI: { value: shared.pythonWorkerRepository.repositoryUri },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: 20,
            },
            commands: ['npm ci'],
          },
          build: {
            commands: [
              'npm run build',
              'npx cdk synth',
              'echo "Build application images here once service Dockerfiles are present."',
            ],
          },
        },
        artifacts: {
          files: ['cdk.out/**/*'],
        },
      }),
    });

    shared.artifactsBucket.grantReadWrite(synthProject);
    shared.springApiRepository.grantPullPush(synthProject);
    shared.pythonWorkerRepository.grantPullPush(synthProject);

    synthProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:GetCallerIdentity'],
        resources: ['*'],
      }),
    );

    if (!config.pipeline) {
      new cdk.CfnOutput(this, 'PipelineConfigurationRequired', {
        value:
          'Pass -c connectionArn=... -c repository=owner/repo -c branch=main to create a source-backed pipeline.',
      });
      return;
    }

    const sourceOutput = new codepipeline.Artifact('Source');
    const synthOutput = new codepipeline.Artifact('SynthOutput');

    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `${config.projectName}-${config.stage}`,
      artifactBucket: shared.artifactsBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new actions.CodeStarConnectionsSourceAction({
              actionName: 'Source',
              connectionArn: config.pipeline.connectionArn,
              owner: config.pipeline.repository.split('/')[0],
              repo: config.pipeline.repository.split('/')[1],
              branch: config.pipeline.branch,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new actions.CodeBuildAction({
              actionName: 'Synth',
              project: synthProject,
              input: sourceOutput,
              outputs: [synthOutput],
            }),
          ],
        },
      ],
    });
  }
}
