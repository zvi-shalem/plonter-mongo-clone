// lessonsAdapter — SAVE_CONTRACT Phase 3 adapter for lesson content.
(function() {
    'use strict';

    if (typeof window === 'undefined') return;
    if (typeof window.AdapterBase !== 'function') {
        console.warn('[LessonsAdapter] AdapterBase not available');
        return;
    }
    if (typeof window.LessonManager === 'undefined') {
        console.warn('[LessonsAdapter] LessonManager not available');
        return;
    }

    var LessonsAdapter = window.AdapterBase({
        type: 'lesson',
        list: function() {
            return LessonManager.loadLessons();
        },
        get: function(id) {
            return LessonManager.getLesson(id);
        },
        load: function(id) {
            return LessonManager.getLesson(id);
        },
        save: function(id, data) {
            return LessonManager.saveSingleLesson(id, data);
        },
        delete: function(id) {
            LessonManager.deleteLesson(id);
            return Promise.resolve(true);
        },
        findCardForId: function(id) {
            return document.querySelector('[data-lesson-id="' + id + '"]') ||
                document.querySelector('.lesson-card[data-id="' + id + '"]');
        }
    });

    LessonsAdapter.onMount();
    window.LessonsAdapter = LessonsAdapter;
})();
