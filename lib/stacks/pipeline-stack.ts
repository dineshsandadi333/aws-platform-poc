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
        SPRING_API_IMAGE_TAG: { value: config.springApiImageTag },
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
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws --version',
              'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $SPRING_API_REPOSITORY_URI',
            ],
          },
          build: {
            commands: [
              'echo Building Spring API jar with Maven...',
              'cd services/spring-api',
              'mvn -B -DskipTests package',
              "echo 'Building Spring API image (runtime base from ECR public)...'",
              'docker build -t $SPRING_API_REPOSITORY_URI:$SPRING_API_IMAGE_TAG .',
              'docker push $SPRING_API_REPOSITORY_URI:$SPRING_API_IMAGE_TAG',
              'cd -',
              'npm run build',
              'npx cdk synth',
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

    // Deploy project: non-self-mutating deployment of application stacks only
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
      environmentVariables: {
        PROJECT_NAME: { value: config.projectName },
        STAGE: { value: config.stage },
        SPRING_API_IMAGE_TAG: { value: config.springApiImageTag },
        SPRING_API_REPOSITORY_URI: { value: shared.springApiRepository.repositoryUri },
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
              'echo Deploying application stacks...',
              'npx cdk deploy SharedStack ApplicationStack --require-approval never -c springApiImageTag=$SPRING_API_IMAGE_TAG',
            ],
          },
        },
      }),
    });

    // Grant deploy project access needed to deploy stacks and read artifacts
    shared.artifactsBucket.grantReadWrite(deployProject);
    shared.springApiRepository.grantPull(deployProject);

    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudformation:*',
          'sts:*',
          'ecs:*',
          'ec2:*',
          'elasticloadbalancing:*',
          'iam:PassRole',
          'iam:GetRole',
          'iam:ListRoles',
        ],
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
              triggerOnPush: true,
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
        {
          stageName: 'Deploy',
          actions: [
            new actions.CodeBuildAction({
              actionName: 'DeployApp',
              project: deployProject,
              input: synthOutput,
            }),
          ],
        },
      ],
    });
  }
}
