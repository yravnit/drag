import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  repositories: {
    chunks: r.many.chunks(),
    files: r.many.repositoryFiles(),
    userRepositories: r.many.userRepositories(),
    accessCaches: r.many.repositoryAccessCache(),
    conversations: r.many.conversations(),
  },
  chunks: {
    repository: r.one.repositories({
      from: r.chunks.repositoryId,
      to: r.repositories.id,
    }),
  },
  repositoryFiles: {
    repository: r.one.repositories({
      from: r.repositoryFiles.repositoryId,
      to: r.repositories.id,
    }),
  },
  user: {
    userRepositories: r.many.userRepositories(),
    accessCaches: r.many.repositoryAccessCache(),
    conversations: r.many.conversations(),
  },
  userRepositories: {
    user: r.one.user({
      from: r.userRepositories.userId,
      to: r.user.id,
    }),
    repository: r.one.repositories({
      from: r.userRepositories.repositoryId,
      to: r.repositories.id,
    }),
  },
  repositoryAccessCache: {
    user: r.one.user({
      from: r.repositoryAccessCache.userId,
      to: r.user.id,
    }),
    repository: r.one.repositories({
      from: r.repositoryAccessCache.repositoryId,
      to: r.repositories.id,
    }),
  },
  conversations: {
    user: r.one.user({
      from: r.conversations.userId,
      to: r.user.id,
    }),
    repository: r.one.repositories({
      from: r.conversations.repositoryId,
      to: r.repositories.id,
    }),
    messages: r.many.messages(),
  },
  messages: {
    conversation: r.one.conversations({
      from: r.messages.conversationId,
      to: r.conversations.id,
    }),
  },
}));
