/**
 * The form names this page's `?notice=` codes belong to.
 *
 * Its own module rather than a constant beside the actions: a `"use server"`
 * file may export **only async functions**, and a plain string exported from
 * one takes the whole module down with it — Next reports "the module has no
 * exports at all" and every action in it stops resolving.
 */
export const EMBED_SETS_FORM = "embed-sets";
