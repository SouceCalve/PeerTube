/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { getAllFiles, wait } from '@peertube/peertube-core-utils'
import { FileStorage, HttpStatusCode, HttpStatusCodeType, VideoPlaylistPrivacy, VideoPrivacy } from '@peertube/peertube-models'
import { areMockObjectStorageTestsDisabled, buildUUID } from '@peertube/peertube-node-utils'
import {
  CLICommand,
  ObjectStorageCommand,
  PeerTubeServer,
  cleanupTests,
  createMultipleServers,
  doubleFollow,
  killallServers,
  makeGetRequest,
  makeRawRequest,
  setAccessTokensToServers,
  setDefaultVideoChannel,
  waitJobs
} from '@peertube/peertube-server-commands'
import { SQLCommand } from '@tests/shared/sql-command.js'
import { expect } from 'chai'
import { createFile } from 'fs-extra/esm'
import { readdir } from 'fs/promises'
import { join } from 'path'

describe('Test prune storage scripts', function () {
  let servers: PeerTubeServer[]

  before(async function () {
    this.timeout(120000)

    servers = await createMultipleServers(2)

    await setAccessTokensToServers(servers)
    await setDefaultVideoChannel(servers)

    for (const server of servers) {
      await server.config.enableMinimumTranscoding({ keepOriginal: true })
      await server.config.enableUserExport()
    }

    for (const server of servers) {
      await server.videos.quickUpload({ name: 'video 1', privacy: VideoPrivacy.PUBLIC })
      await server.videos.quickUpload({ name: 'video 2', privacy: VideoPrivacy.PUBLIC })

      await server.videos.quickUpload({ name: 'video 3', privacy: VideoPrivacy.PRIVATE })

      await server.users.updateMyAvatar({ fixture: 'avatar.png' })

      await server.playlists.create({
        attributes: {
          displayName: 'playlist',
          privacy: VideoPlaylistPrivacy.PUBLIC,
          videoChannelId: server.store.channel.id,
          thumbnailfile: 'custom-thumbnail.jpg'
        }
      })
    }

    for (const server of servers) {
      const user = await server.users.getMyInfo()

      await server.userExports.request({ userId: user.id, withVideoFiles: false })
    }

    await doubleFollow(servers[0], servers[1])

    // Lazy load the remote avatars
    {
      const account = await servers[0].accounts.get({ accountName: 'root@' + servers[1].host })

      for (const avatar of account.avatars) {
        await makeGetRequest({
          url: servers[0].url,
          path: avatar.path,
          expectedStatus: HttpStatusCode.OK_200
        })
      }
    }

    {
      const account = await servers[1].accounts.get({ accountName: 'root@' + servers[0].host })
      for (const avatar of account.avatars) {
        await makeGetRequest({
          url: servers[1].url,
          path: avatar.path,
          expectedStatus: HttpStatusCode.OK_200
        })
      }
    }

    await wait(1000)

    await waitJobs(servers)
    await killallServers(servers)

    await wait(1000)
  })

  describe('On filesystem', function () {
    const badNames: { [directory: string]: string[] } = {}

    async function assertNotExists (server: PeerTubeServer, directory: string, substring: string) {
      const files = await readdir(server.servers.buildDirectory(directory))

      for (const f of files) {
        expect(f).to.not.contain(substring)
      }
    }

    async function assertCountAreOkay () {
      for (const server of servers) {
        const videosCount = await server.servers.countFiles('web-videos')
        expect(videosCount).to.equal(5) // 2 videos with 2 resolutions + private directory

        const privateVideosCount = await server.servers.countFiles('web-videos/private')
        expect(privateVideosCount).to.equal(2)

        const torrentsCount = await server.servers.countFiles('torrents')
        expect(torrentsCount).to.equal(12)

        const previewsCount = await server.servers.countFiles('previews')
        expect(previewsCount).to.equal(3)

        const thumbnailsCount = await server.servers.countFiles('thumbnails')
        expect(thumbnailsCount).to.equal(5) // 3 local videos, 1 local playlist, 2 remotes videos (lazy downloaded) and 1 remote playlist

        const avatarsCount = await server.servers.countFiles('avatars')
        expect(avatarsCount).to.equal(8)

        const hlsRootCount = await server.servers.countFiles(join('streaming-playlists', 'hls'))
        expect(hlsRootCount).to.equal(3) // 2 videos + private directory

        const hlsPrivateRootCount = await server.servers.countFiles(join('streaming-playlists', 'hls', 'private'))
        expect(hlsPrivateRootCount).to.equal(1)

        const originalVideoFilesCount = await server.servers.countFiles(join('original-video-files'))
        expect(originalVideoFilesCount).to.equal(3)

        const userExportFilesCount = await server.servers.countFiles(join('tmp-persistent'))
        expect(userExportFilesCount).to.equal(1)
      }
    }

    it('Should have the files on the disk', async function () {
      await assertCountAreOkay()
    })

    it('Should create some dirty files', async function () {
      for (let i = 0; i < 2; i++) {
        {
          const basePublic = servers[0].servers.buildDirectory('web-videos')
          const basePrivate = servers[0].servers.buildDirectory(join('web-videos', 'private'))

          const n1 = buildUUID() + '.mp4'
          const n2 = buildUUID() + '.webm'

          await createFile(join(basePublic, n1))
          await createFile(join(basePublic, n2))
          await createFile(join(basePrivate, n1))
          await createFile(join(basePrivate, n2))

          badNames['web-videos'] = [ n1, n2 ]
        }

        {
          const base = servers[0].servers.buildDirectory('torrents')

          const n1 = buildUUID() + '-240.torrent'
          const n2 = buildUUID() + '-480.torrent'

          await createFile(join(base, n1))
          await createFile(join(base, n2))

          badNames['torrents'] = [ n1, n2 ]
        }

        {
          const base = servers[0].servers.buildDirectory('thumbnails')

          const n1 = buildUUID() + '.jpg'
          const n2 = buildUUID() + '.jpg'

          await createFile(join(base, n1))
          await createFile(join(base, n2))

          badNames['thumbnails'] = [ n1, n2 ]
        }

        {
          const base = servers[0].servers.buildDirectory('previews')

          const n1 = buildUUID() + '.jpg'
          const n2 = buildUUID() + '.jpg'

          await createFile(join(base, n1))
          await createFile(join(base, n2))

          badNames['previews'] = [ n1, n2 ]
        }

        {
          const base = servers[0].servers.buildDirectory('avatars')

          const n1 = buildUUID() + '.png'
          const n2 = buildUUID() + '.jpg'

          await createFile(join(base, n1))
          await createFile(join(base, n2))

          badNames['avatars'] = [ n1, n2 ]
        }

        {
          const directory = join('streaming-playlists', 'hls')
          const basePublic = servers[0].servers.buildDirectory(directory)
          const basePrivate = servers[0].servers.buildDirectory(join(directory, 'private'))

          const n1 = buildUUID()
          await createFile(join(basePublic, n1))
          await createFile(join(basePrivate, n1))
          badNames[directory] = [ n1 ]
        }

        {
          const base = servers[0].servers.buildDirectory('original-video-files')

          const n1 = buildUUID() + '.mp4'
          await createFile(join(base, n1))

          badNames['original-video-files'] = [ n1 ]
        }

        {
          const base = servers[0].servers.buildDirectory('tmp-persistent')

          const n1 = 'user-export-1.zip'
          const n2 = 'user-export-2.zip'

          await createFile(join(base, n1))
          await createFile(join(base, n2))

          badNames['tmp-persistent'] = [ n1, n2 ]
        }
      }
    })

    it('Should run prune storage', async function () {
      this.timeout(30000)

      const env = servers[0].cli.getEnv()
      await CLICommand.exec(`echo y | ${env} npm run prune-storage`)
    })

    it('Should have removed files', async function () {
      await assertCountAreOkay()

      for (const directory of Object.keys(badNames)) {
        for (const name of badNames[directory]) {
          await assertNotExists(servers[0], directory, name)
        }
      }
    })
  })

  describe('On object storage', function () {
    if (areMockObjectStorageTestsDisabled()) return

    const videos: string[] = []
    const objectStorage = new ObjectStorageCommand()

    let sqlCommand: SQLCommand
    let rootId: number

    async function checkVideosFiles (uuids: string[], expectedStatus: HttpStatusCodeType) {
      for (const uuid of uuids) {
        const video = await servers[0].videos.getWithToken({ id: uuid })

        for (const file of getAllFiles(video)) {
          await makeRawRequest({ url: file.fileUrl, token: servers[0].accessToken, expectedStatus })
        }

        const source = await servers[0].videos.getSource({ id: uuid })
        await makeRawRequest({ url: source.fileDownloadUrl, redirects: 1, token: servers[0].accessToken, expectedStatus })
      }
    }

    async function checkUserExport (expectedStatus: HttpStatusCodeType) {
      const { data } = await servers[0].userExports.list({ userId: rootId })
      await makeRawRequest({ url: data[0].privateDownloadUrl, redirects: 1, expectedStatus })
    }

    before(async function () {
      this.timeout(120000)

      sqlCommand = new SQLCommand(servers[0])

      await objectStorage.prepareDefaultMockBuckets()

      await servers[0].run(objectStorage.getDefaultMockConfig())

      {
        const { uuid } = await servers[0].videos.quickUpload({ name: 's3 video 1', privacy: VideoPrivacy.PUBLIC })
        videos.push(uuid)
      }

      {
        const { uuid } = await servers[0].videos.quickUpload({ name: 's3 video 2', privacy: VideoPrivacy.PUBLIC })
        videos.push(uuid)
      }

      {
        const { uuid } = await servers[0].videos.quickUpload({ name: 's3 video 3', privacy: VideoPrivacy.PRIVATE })
        videos.push(uuid)
      }

      const user = await servers[0].users.getMyInfo()
      rootId = user.id

      await servers[0].userExports.deleteAllArchives({ userId: rootId })
      await servers[0].userExports.request({ userId: rootId, withVideoFiles: false })

      await waitJobs([ servers[0] ])
    })

    it('Should have the files on object storage', async function () {
      await checkVideosFiles(videos, HttpStatusCode.OK_200)
      await checkUserExport(HttpStatusCode.OK_200)
    })

    it('Should run prune-storage script on videos', async function () {
      await sqlCommand.setVideoFileStorageOf(videos[1], FileStorage.FILE_SYSTEM)
      await sqlCommand.setVideoFileStorageOf(videos[2], FileStorage.FILE_SYSTEM)

      await checkVideosFiles([ videos[1], videos[2] ], HttpStatusCode.NOT_FOUND_404)
      await checkVideosFiles([ videos[0] ], HttpStatusCode.OK_200)

      await checkUserExport(HttpStatusCode.OK_200)
    })

    it('Should run prune-storage script on exports', async function () {
      await sqlCommand.setUserExportStorageOf(rootId, FileStorage.FILE_SYSTEM)

      await checkVideosFiles([ videos[1], videos[2] ], HttpStatusCode.NOT_FOUND_404)
      await checkVideosFiles([ videos[0] ], HttpStatusCode.OK_200)

      await checkUserExport(HttpStatusCode.NOT_FOUND_404)
    })

    after(async function () {
      await sqlCommand.cleanup()
    })
  })

  after(async function () {
    await cleanupTests(servers)
  })
})
