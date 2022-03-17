import {Sequelize, BIGINT, STRING, QueryTypes} from "sequelize";
import {Mutex} from "async-mutex";
import {PostJSON} from "../util/message";
import {inflateResultToPostJSON} from "./posts";

type TagModel = {
    tag_name: string;
    message_id: string;
};

const mutex = new Mutex();

const tags = (sequelize: Sequelize) => {
    const model = sequelize.define('tags', {
        tag_name: {
            type: STRING,
        },
        message_id: {
            type: STRING,
        },
    }, {
        indexes: [
            { fields: ['tag_name', 'message_id'], unique: true }
        ],
    });

    const addTagPost = async (tagName: string, messageId: string) => {
        return mutex.runExclusive(async () => {
            const res = await model.create({
                tag_name: tagName,
                message_id: messageId,
            });

            return res;
        });
    }

    const removeTagPost = async (tagName: string, messageId: string) => {
        return mutex.runExclusive(async () => {
            try {
                const res = await model.destroy({
                    where: {
                        tag_name: tagName,
                        message_id: messageId,
                    },
                });
                return res;
            } catch (e) {
                return false;
            }
        });
    }

    const getPostsByTag = async (
        tagName: string,
        context?: string,
        offset = 0,
        limit = 20,
        order: 'DESC' | 'ASC' = 'DESC',
    ) => {
        const result = await sequelize.query(`
            ${selectTagPostsQuery}
            WHERE p."createdAt" != -1 AND t."tag_name" = :tagName AND (blk."messageId" IS NULL AND rpblk."messageId" IS NULL) AND p."creator" NOT IN (SELECT name FROM connections WHERE name = p.creator AND creator = :context AND subtype = 'BLOCK')
            ORDER BY p."createdAt" ${order}
            LIMIT :limit OFFSET :offset
        `, {
            replacements: {
                context: context || '',
                limit,
                offset,
                tagName,
            },
            type: QueryTypes.SELECT,
        });

        const values: PostJSON[] = [];

        for (let r of result) {
            const post = inflateResultToPostJSON(r);
            values.push(post);
        }

        return values;
    }

    return {
        model,
        getPostsByTag,
        addTagPost,
        removeTagPost,
    };
}

export default tags;

const selectTagPostsQuery = `
    SELECT
        p.hash,
        p.creator,
        p.type,
        p.subtype,
        p."createdAt",
        p.topic,
        p.title,
        p.content,
        p.reference,
        p.attachment,
        m."messageId" as "liked",
        rpm."messageId" as "rpLiked",
        blk."messageId" as blocked,
        rpblk."messageId" as "rpBlocked",
        rp."messageId" as "reposted",
        rprp."messageId" as "rpReposted",
        thrdmod.subtype as "moderation",
        modliked."messageId" as "modLikedPost",
        modblocked."messageId" as "modBlockedPost",
        modblockeduser."messageId" as "modBlockedUser",
        modfolloweduser."messageId" as "modFollowerUser",
        mt."replyCount",
        mt."repostCount",
        mt."likeCount",
        rpmt."replyCount" as "rpReplyCount",
        rpmt."repostCount" as "rpRepostCount",
        rpmt."likeCount" as "rpLikeCount",
        rpsc.provider as "rpInterepProvider",
        rpsc.group as "rpInterepGroup",
        sc.provider as "interepProvider",
        sc.group as "interepGroup"
    FROM tags t
        LEFT JOIN posts p ON p."messageId" = t."message_id"
        LEFT JOIN moderations m ON m."messageId" = (SELECT "messageId" FROM moderations WHERE reference = p."messageId" AND creator = :context LIMIT 1)
        LEFT JOIN moderations rpm ON rpm."messageId" = (select "messageId" from moderations where reference = p.reference AND creator = :context  AND p.subtype = 'REPOST' LIMIT 1)
        LEFT JOIN moderations blk ON blk."messageId" = (SELECT "messageId" FROM moderations WHERE subtype = 'BLOCK' AND reference = p."messageId" AND creator = :context LIMIT 1)
        LEFT JOIN moderations rpblk ON rpblk."messageId" = (select "messageId" from moderations where subtype = 'BLOCK' AND reference = p.reference AND creator = :context AND p.subtype = 'REPOST' LIMIT 1)
        LEFT JOIN threads thrd ON thrd."message_id" = p."messageId"
        LEFT JOIN posts root ON thrd.root_id = root."messageId"
        LEFT JOIN moderations thrdmod ON thrdmod."messageId" = (select "messageId" from moderations where creator = root.creator AND subtype IN ('THREAD_HIDE_BLOCK', 'THREAD_SHOW_FOLLOW', 'THREAD_ONLY_MENTION') AND reference = root."messageId" LIMIT 1)
        LEFT JOIN moderations modliked ON modliked."messageId" = (SELECT "messageId" FROM moderations WHERE subtype = 'LIKE' AND reference = p."messageId" AND creator = root.creator LIMIT 1)
        LEFT JOIN moderations modblocked ON modblocked."messageId" = (SELECT "messageId" FROM moderations WHERE subtype = 'BLOCK' AND reference = p."messageId" AND creator = root.creator LIMIT 1)
        LEFT JOIN connections modblockeduser ON modblockeduser."messageId" = (SELECT "messageId" FROM connections WHERE subtype = 'BLOCK' AND name = p."creator" AND creator = root.creator LIMIT 1)
        LEFT JOIN connections modfolloweduser ON modfolloweduser."messageId" = (SELECT "messageId" FROM connections WHERE subtype = 'FOLLOW' AND name = p."creator" AND creator = root.creator LIMIT 1)
        LEFT JOIN posts rp ON rp."messageId" = (SELECT "messageId" from posts WHERE p."messageId" = reference AND creator = :context AND subtype = 'REPOST' LIMIT 1)
        LEFT JOIN posts rprp ON rprp."messageId" = (SELECT "messageId" from posts WHERE reference = p.reference AND creator = :context AND subtype = 'REPOST' AND p.subtype = 'REPOST' LIMIT 1)
        LEFT JOIN meta mt ON mt."reference" = p."messageId"
        LEFT JOIN meta rpmt ON p.subtype = 'REPOST' AND rpmt."reference" = p.reference
        LEFT JOIN semaphore_creators sc on sc."message_id" = p."messageId"
        LEFT JOIN semaphore_creators rpsc on p.subtype = 'REPOST' AND rpsc."message_id" = p."reference"
`;