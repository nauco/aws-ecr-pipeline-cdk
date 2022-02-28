import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from "@aws-cdk/aws-codepipeline-actions";
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as ecr from '@aws-cdk/aws-ecr';
import * as s3 from '@aws-cdk/aws-s3'

import * as base from './base-stack';
import { AppContext } from '../lib/app-context';
import { link } from 'fs';
import { config } from 'process';
import { BuildEnvironmentVariableType, LocalCacheMode } from '@aws-cdk/aws-codebuild';

export class AwsCodepipelineCdkStack extends base.BaseStack {

  //public gitRepo: codecommit.Repository;
  public ecrRepo: ecr.IRepository;
  public pipeline: codepipeline.Pipeline;

  constructor(appContext: AppContext, stackConfig: any) {
    super(appContext, stackConfig);

    console.log(this.stackConfig);

    // this.gitRepo = new codecommit.Repository(this, `${this.projectPrefix}Repository`, {
    //   repositoryName: `${this.projectPrefix}-repo`.toLowerCase(),
    //   description: "source code repository"
    // })

    // this.ecrRepo = new ecr.Repository(this, `${stackConfig.Name}EcrRepository`, {
    //   repositoryName: `${stackConfig.Name}-repo`.toLowerCase(),
    //   //removalPolicy: cdk.RemovalPolicy.RETAIN,
    // });

    this.ecrRepo = ecr.Repository.fromRepositoryName(this, `${stackConfig.Name}-ecr`, stackConfig.ImageRepo);


    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = this.setSourceAction(sourceOutput, this.stackConfig);

    const sourceRootOutput = new codepipeline.Artifact();
    const sourceRootAction = new actions.CodeStarConnectionsSourceAction({
      actionName: 'Bitbucket_SourceMerge',
      variablesNamespace: 'root',
      connectionArn: stackConfig.BitbucketConnectionArn,
      output: sourceRootOutput,
      repo: "mzc-kraken",
      owner: stackConfig.SourceOwner,
      branch: "main",
    })
    // const sourceAction = new actions.CodeCommitSourceAction({
    //   actionName: 'CodeCommit_SourceMerge',
    //   repository: this.gitRepo,
    //   output: sourceOutput,
    //   branch: 'master'
    // });

    const buildOutput = new codepipeline.Artifact();
    const buildAction = new actions.CodeBuildAction({
      actionName: 'CodeBuild_DockerBuild',
      environmentVariables: {
        //DOCKERHUB_USER: { value: '#{mzc-cpd-codebuild-docker-hub:username}'},
        //DOCKERHUB_PASS: { value: '#{mzc-cpd-codebuild-docker-hub:password}'}
        BITBUCKET_PASSWORD: { 
          type: BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: 'devops-bitbucket:password'}
      },
      project: this.createBuildProject(this.ecrRepo, stackConfig),
      input: sourceOutput, 
      outputs: [buildOutput],
    });

    const approvalAction = new actions.ManualApprovalAction({
      actionName: 'Manual_Approve',
    });


    new codepipeline.Pipeline(this, `${stackConfig.Name}-pp`, {
      pipelineName: `${stackConfig.Name}-pipeline`,
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Approve',
          actions: [approvalAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        }
      ]
    });
  }

  private setSourceAction(sourceOutput: codepipeline.Artifact, config: any): actions.Action {
    const sourceList = ["Github", "CodeCommit", "Bitbucket", "New"]

    var repo: actions.CodeCommitSourceAction | actions.CodeStarConnectionsSourceAction | actions.GitHubSourceAction;
    var source: string = config.Source;

    if (!sourceList.includes(config.Source)) source = "New"

    if (source === "Github") {
      repo = new actions.GitHubSourceAction({
        actionName: 'Github_SourceMerge',
        oauthToken: config.GithubAuthToken,
        output: sourceOutput,
        repo: config.SourceRepoName,
        owner: config.SourceOwner,

      })
    } 
    else if (source === "CodeCommit") {      
      repo = new actions.CodeCommitSourceAction({
        actionName: 'CodeCommit_SourceMerge',
        repository: codecommit.Repository.fromRepositoryName(this, 'CodeCommitRepo', `${config.SourceRepoName}`),
        output: sourceOutput,
        branch: config.Branch,
      });
    }
    else if (source === "Bitbucket") {
      repo = new actions.CodeStarConnectionsSourceAction({
        actionName: 'Bitbucket_SourceMerge',
        connectionArn: config.BitbucketConnectionArn,
        output: sourceOutput,
        repo: config.SourceRepoName,
        owner: config.SourceOwner,
        branch: config.Branch,
      })
    }
    else {
      repo = new actions.CodeCommitSourceAction({
        actionName: 'CodeCommit_SourceMerge',
        repository: new codecommit.Repository(this, `${this.stackConfig.Name}Repository`, {
          repositoryName: `${this.stackConfig.Name}-repo`.toLowerCase(),
          description: "source code repository",
        }),
        output: sourceOutput,
        branch: config.Branch
      })
    }
    return repo;

  }

  private createBuildProject(ecrRepo: ecr.IRepository, props: any): codebuild.PipelineProject {
    const project = new codebuild.Project(this, 'DockerBuild', {
      projectName: `${this.stackConfig.Name}DockerBuild`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true
      },
      cache: codebuild.Cache.bucket(s3.Bucket.fromBucketName(this, `${this.stackConfig.SourceRepoName}-dev-cache`, `${this.stackConfig.SourceRepoName}-dev-cache`)),
      environmentVariables: {
        'DOMAIN_NAME': {
          value: `${this.stackConfig.SourceRepoName}`
        },
        'CONTAINER_NAME': {
          value: `${this.stackConfig.SourceRepoName}`
        },
        'GRADLE_ENV': {
          value: `dev`
        },
        'AWS_DEFAULT_REGION': {
          value: 'ap-northeast-2'
        },
        'APP_NAME': {
          value: `${this.stackConfig.SourceRepoName}`
        },
        'VERSION': {
          value: 'latest'
        }
      },
      secondarySources: [
        codebuild.Source.bitBucket({
          owner: "megazone",
          repo: "mzc-kraken",
          identifier: "root",
          branchOrRef: "main",
        })
      ],
      
      buildSpec: codebuild.BuildSpec.fromSourceFilename('src/main/apps/user-rest-api/buildspec-dev.yml'),
      // buildSpec: codebuild.BuildSpec.fromObject({
      //   version: "0.2",
      //   phases: {
      //     install: {
      //       'runtime-versions': {
      //         java: "corretto11"
      //       }
      //     },
      //     pre_build: {
      //       commands: [
      //         'echo Logging in to Docker Hub...',
      //         'echo $DOCKERHUB_PASS | docker login --username $DOCKERHUB_USER --password-stdin',
      //         'echo Logging in to Amazon ECR...',
      //         'aws --version',
      //         '$(aws ecr get-login --no-include-email --region ap-northeast-2 --registry-ids 179248873946)',
      //         'env'
      //       ]
      //     },
      //     build: {
      //       commands: [
      //         'echo -------- Build started on `date` --------',
      //         './gradlew :openApiGenerate',
      //         './gradlew :jib',
      //       ]
      //     },
      //     post_build: {
      //       commands: [
      //         'printf \'[{"name":"%s","imageUri":"%s"}]\' $APP_NAME $ECR_REPO_URI:latest > imagedefinitions.json',
      //         'cat imagedefinitions.json'
      //       ]
      //     }
      //   },
      //   artifacts: {
      //     files: [
      //       'imagedefinitions.json'
      //     ]
      //   },
      //   cache: {
      //     paths: [
      //       '/root/.gradle/caches/**/*' ,
      //       '/root/.gradle/wrapper/**/*'
      //     ]
      //   }
      // }),
    });

    ecrRepo.grantPullPush(project.role!);

    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        // "ecr:GetAuthorizationToken",
        // "ecr:BatchCheckLayerAvailability",
        // "ecr:BatchGetImage",
        // "ecr:GetDownloadUrlForLayer",
        // "codeartifact:GetAuthorizationToken",
        // "sts:GetServiceBearerToken",
        "secretsmanager:*",
        "ecr:*",
        "sts:*",
        "ssm:*",
        "codeartifact:*",
      ],
      resources: ["*"],
    }));

    return project;
  }

  protected exportOutput(key: string, value: string) {
    new cdk.CfnOutput(this, `Output-${key}`, {
      exportName: `${this.stackName}-${key}`,
      value: value
    });
  }
}
