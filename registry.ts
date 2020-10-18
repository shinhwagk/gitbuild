export class RegistryApiCli {
  constructor(regesthost: string, username: string, password: string) {
  }
  // quay.io api
  // https://docs.quay.io/api/swagger/
  // docker.io api
  // https://devopsheaven.com/docker/dockerhub/2018/04/09/delete-docker-image-tag-dockerhub.html
  // curl -u $USERNAME:$PASSWORD -X "DELETE" https://cloud.docker.com/v2/repositories/$ORGANIZATION/$REPOSITORY/tags/$TAG/
  delete(name: string, tags: string) {
  }
  login() {
  }
}
