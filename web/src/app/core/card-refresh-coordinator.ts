import { Injectable } from "@angular/core";
import { catchError, debounceTime, filter, groupBy, map, merge, mergeMap, Observable, of, share, switchMap } from "rxjs";
import type { CardDetail } from "../../../../src/shared/lifecycle-contract";
import { CardApiService } from "./card-api.service";

export type RefreshResult =
  | { kind: "targeted"; card: CardDetail; animate: true }
  | { kind: "full"; animate: false };

@Injectable({ providedIn: "root" })
export class CardRefreshCoordinator {
  readonly refreshes$: Observable<RefreshResult>;

  constructor(private readonly api: CardApiService) {
    const notifications = api.notifications().pipe(share());
    const targeted = notifications.pipe(
      filter((notification) => notification.kind === "card"),
      groupBy((notification) => notification.event.cardId),
      mergeMap((group) =>
        group.pipe(
          debounceTime(150),
          switchMap((notification) =>
            this.api.getCard(notification.event.cardId).pipe(
              map((card): RefreshResult => ({ kind: "targeted", card, animate: true })),
              catchError(() => of<RefreshResult>({ kind: "full", animate: false })),
            ),
          ),
        ),
      ),
    );
    const full = notifications.pipe(
      filter((notification) => notification.kind === "reconnected" || notification.kind === "project"),
      map((): RefreshResult => ({ kind: "full", animate: false })),
    );
    this.refreshes$ = merge(targeted, full).pipe(share());
  }
}
