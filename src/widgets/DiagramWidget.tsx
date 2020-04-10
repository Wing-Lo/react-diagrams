import * as React from "react";
import { DiagramEngine } from "../DiagramEngine";
import * as _ from "lodash";
import { LinkLayerWidget } from "./layers/LinkLayerWidget";
import { NodeLayerWidget } from "./layers/NodeLayerWidget";
import { Toolkit } from "../Toolkit";
import { BaseAction } from "../actions/BaseAction";
import { MoveCanvasAction } from "../actions/MoveCanvasAction";
import { MoveItemsAction } from "../actions/MoveItemsAction";
import { SelectingAction } from "../actions/SelectingAction";
import { NodeModel } from "../models/NodeModel";
import { PointModel } from "../models/PointModel";
import { PortModel } from "../models/PortModel";
import { LinkModel } from "../models/LinkModel";
import { SelectionModel } from "../models/SelectionModel";
import { BaseModel, BaseModelListener } from "../models/BaseModel";
import { BaseEntity } from "../BaseEntity";
import { BaseWidget, BaseWidgetProps } from "./BaseWidget";
import { DefaultNodeModel } from "storm-react-diagrams";

export interface DiagramProps extends BaseWidgetProps {
	diagramEngine: DiagramEngine;

	allowLooseLinks?: boolean;
	autoChangePort?:boolean;
	allowCanvasTranslation?: boolean;
	allowCanvasZoom?: boolean;
	inverseZoom?: boolean;
	maxNumberPointsPerLink?: number;
	smartRouting?: boolean;

	actionStartedFiring?: (action: BaseAction) => boolean;
	actionStillFiring?: (action: BaseAction) => void;
	actionStoppedFiring?: (action: BaseAction) => void;

	deleteKeys?: number[];
}

export interface DiagramState {
	action: BaseAction | null;
	wasMoved: boolean;
	renderedNodes: boolean;
	windowListener: any;
	diagramEngineListener: any;
	document: any;
}

/**
 * @author Dylan Vorster
 */
export class DiagramWidget extends BaseWidget<DiagramProps, DiagramState> {
	public static defaultProps: DiagramProps = {
		diagramEngine: null,
		allowLooseLinks: true,
		allowCanvasTranslation: true,
		allowCanvasZoom: true,
		inverseZoom: false,
		maxNumberPointsPerLink: Infinity, // backwards compatible default
		smartRouting: false,
		deleteKeys: [46, 8]
	};

	onKeyUpPointer: (this: Window, ev: KeyboardEvent) => void = null;

	constructor(props: DiagramProps) {
		super("srd-diagram", props);
		this.onMouseMove = this.onMouseMove.bind(this);
		this.onMouseUp = this.onMouseUp.bind(this);
		this.state = {
			action: null,
			wasMoved: false,
			renderedNodes: false,
			windowListener: null,
			diagramEngineListener: null,
			document: null
		};
	}

	componentWillUnmount() {
		this.props.diagramEngine.removeListener(this.state.diagramEngineListener);
		this.props.diagramEngine.setCanvas(null);
		window.removeEventListener("keyup", this.onKeyUpPointer);
		window.removeEventListener("mouseUp", this.onMouseUp);
		window.removeEventListener("mouseMove", this.onMouseMove);
		window.removeEventListener("touchend", this.onMouseUp);
		window.removeEventListener("touchmove", this.onMouseMove);
	}

	componentWillReceiveProps(nextProps: DiagramProps) {
		if (this.props.diagramEngine !== nextProps.diagramEngine) {
			this.props.diagramEngine.removeListener(this.state.diagramEngineListener);
			const diagramEngineListener = nextProps.diagramEngine.addListener({
				repaintCanvas: () => this.forceUpdate()
			});
			this.setState({ diagramEngineListener });
		}
	}

	componentWillUpdate(nextProps: DiagramProps) {
		if (this.props.diagramEngine.diagramModel.id !== nextProps.diagramEngine.diagramModel.id) {
			this.setState({ renderedNodes: false });
			nextProps.diagramEngine.diagramModel.rendered = true;
		}
		if (!nextProps.diagramEngine.diagramModel.rendered) {
			this.setState({ renderedNodes: false });
			nextProps.diagramEngine.diagramModel.rendered = true;
		}
	}

	componentDidUpdate() {
		if (!this.state.renderedNodes) {
			this.setState({
				renderedNodes: true
			});
		}
	}

	componentDidMount() {
		this.onKeyUpPointer = this.onKeyUp.bind(this);

		//add a keyboard listener
		this.setState({
			document: document,
			renderedNodes: true,
			diagramEngineListener: this.props.diagramEngine.addListener({
				repaintCanvas: () => {
					this.forceUpdate();
				}
			})
		});

		window.addEventListener("keyup", this.onKeyUpPointer, false);

		// dont focus the window when in test mode - jsdom fails
		if (process.env.NODE_ENV !== "test") {
			window.focus();
		}
	}

	/**
	 * Gets a model and element under the mouse cursor
	 */
	getMouseElement(event): { model: BaseModel<BaseEntity, BaseModelListener>; element: Element } {
		var target = Toolkit.getTouchMouseTargetElement(event) as Element;
		var diagramModel = this.props.diagramEngine.diagramModel;

		//is it a port
		var element = Toolkit.closest(target, ".port[data-name]");
		if (element) {
			var nodeElement = Toolkit.closest(target, ".node[data-nodeid]") as HTMLElement;
			return {
				model: diagramModel
					.getNode(nodeElement.getAttribute("data-nodeid"))
					.getPort(element.getAttribute("data-name")),
				element: element
			};
		}

		//look for a point
		element = Toolkit.closest(target, ".point[data-id]");
		if (element) {
			return {
				model: diagramModel
					.getLink(element.getAttribute("data-linkid"))
					.getPointModel(element.getAttribute("data-id")),
				element: element
			};
		}

		//look for a link
		element = Toolkit.closest(target, "[data-linkid]");
		if (element) {
			return {
				model: diagramModel.getLink(element.getAttribute("data-linkid")),
				element: element
			};
		}

		//look for a node
		element = Toolkit.closest(target, ".node[data-nodeid]");
		if (element) {
			return {
				model: diagramModel.getNode(element.getAttribute("data-nodeid")),
				element: element
			};
		}

		return null;
	}

	fireAction() {
		if (this.state.action && this.props.actionStillFiring) {
			this.props.actionStillFiring(this.state.action);
		}
	}

	stopFiringAction(shouldSkipEvent?: boolean) {
		if (this.props.actionStoppedFiring && !shouldSkipEvent) {
			this.props.actionStoppedFiring(this.state.action);
		}
		this.setState({ action: null });
	}

	startFiringAction(action: BaseAction) {
		var setState = true;
		if (this.props.actionStartedFiring) {
			setState = this.props.actionStartedFiring(action);
		}
		if (setState) {
			this.setState({ action: action });
		}
	}

	onMouseMove(event) {
		var diagramEngine = this.props.diagramEngine;
		var diagramModel = diagramEngine.getDiagramModel();
		//select items so draw a bounding box
		if (this.state.action instanceof SelectingAction) {
			var relative = diagramEngine.getRelativePoint(Toolkit.getClientX(event), Toolkit.getClientY(event));

			_.forEach(diagramModel.getNodes(), node => {
				if ((this.state.action as SelectingAction).containsElement(node.x, node.y, diagramModel)) {
					node.setSelected(true);
				}
			});

			_.forEach(diagramModel.getLinks(), link => {
				var allSelected = true;
				_.forEach(link.points, point => {
					if ((this.state.action as SelectingAction).containsElement(point.x, point.y, diagramModel)) {
						point.setSelected(true);
					} else {
						allSelected = false;
					}
				});

				if (allSelected) {
					link.setSelected(true);
				}
			});

			this.state.action.mouseX2 = relative.x;
			this.state.action.mouseY2 = relative.y;

			this.fireAction();
			this.setState({ action: this.state.action });
			return;
		} else if (this.state.action instanceof MoveItemsAction) {
			let amountX = Toolkit.getClientX(event) - this.state.action.mouseX;
			let amountY = Toolkit.getClientY(event) - this.state.action.mouseY;
			let amountZoom = diagramModel.getZoomLevel() / 100;
			let selectionModels = this.state.action.selectionModels;
			_.forEach(selectionModels, model => {
				// in this case we need to also work out the relative grid position
				if (
					model.model instanceof NodeModel ||
					(model.model instanceof PointModel && !model.model.isConnectedToPort())
				) {
					model.model.x = diagramModel.getGridPosition(model.initialX + amountX / amountZoom);
					model.model.y = diagramModel.getGridPosition(model.initialY + amountY / amountZoom);

					if (model.model instanceof NodeModel) {
						model.model.positionChanged();
						// update port coordinates as well
						_.forEach(model.model.getPorts(), port => {
							const portCoords = this.props.diagramEngine.getPortCoords(port);
							port.updateCoords(portCoords);
							let autoChangePort = this.props.autoChangePort || false;
							if(autoChangePort){
								// 1. iter each link
								// 2. get link's sourceNode and targetNode
								// 3. calculate nearest port between two node
								// 4. create new link and added to diagramModel
								// 5. diagramEngine.repaintCanvas();
								// 6. old link remove;
								// 7. calculate new point initialX and Y by old point's port's x substract new point's port's x
								_.values(port.getLinks()).forEach((link) => {
									var isSourcePort = false;
									if(link.getSourcePort().getID() === port.getID()){
										isSourcePort = true;
									}
									let point = link.getPointForPort(port);
									if(link.getTargetPort() === null || link.getTargetPort() === null){
										return
									}
									let sourceNode = link.getSourcePort().getParent() as DefaultNodeModel;
									let targetNode = link.getTargetPort().getParent() as DefaultNodeModel;
									function getDistance(port1, port2) {
										var distance = Math.pow(port1.x - port2.x, 2) + Math.pow(port1.y - port2.y, 2);
										return Math.sqrt(distance);
									}
									var minDistance = getDistance(link.getSourcePort(), link.getTargetPort());
									var minPort1 = undefined;
									var minPort2 = undefined;
									_.values(sourceNode.getPorts()).forEach(port1 => {
										_.values(targetNode.getPorts()).forEach(port2 => {
											const portCoords = this.props.diagramEngine.getPortCoords(port2);
											port2.updateCoords(portCoords);
											if(port1.x && port1.y && port2.x && port2.y){
												var distance = getDistance(port1, port2);
												if(minDistance == null || minDistance - distance > 10){
													minDistance = distance;
													minPort1 = port1;
													minPort2 = port2;
												}
											}
										})
									});
									if(minPort1 !== undefined && (minPort1.getID() !== link.getSourcePort().getID() || minPort2.getID() !== link.getTargetPort().getID())){
										// source在target的右侧，但source的port还是out
										let oldLinkId = link.getID();
										let newLink = minPort1.link(minPort2);

										diagramModel.addLink(newLink);
										// 只有重新绘制才能获取到point的x和y
										diagramEngine.repaintCanvas();
										link.remove();
										// diagramEngine.setDiagramModel(diagramModel);
										let newPoint:PointModel = null;
										let newPort:PortModel = null;
										if(isSourcePort){
											newPoint = newLink.getPointForPort(minPort1);
											newPort = minPort1;
										}else{
											newPoint = newLink.getPointForPort(minPort2);
											newPort = minPort2;
										}

										// let deltaX = point.x - newPoint.x;
										let deltaX = port.x - newPort.x;
										// let deltaY = point.y - newPoint.y;
										let deltaY = port.y - newPort.y;
										if(newPoint){
											let initialX = 0;
											let initialY = 0;
											_.forEach(selectionModels, (model) => {
												if (model.model instanceof PointModel) {
													initialX = model.initialX - deltaX;
													initialY = model.initialY - deltaY;
													return
												}
											});
											newPoint.selected = true;
											selectionModels = _.filter(selectionModels, model => {
												return !(model.model instanceof PointModel);
											});
											selectionModels.push({
												model: newPoint,
												initialX: initialX,
												initialY: initialY,
											});
											// @ts-ignore
											this.state.action.selectionModels = selectionModels;
											diagramEngine.clearRepaintEntities();
										}
									}
								});
							}
						});
					}

					if (diagramEngine.isSmartRoutingEnabled()) {
						diagramEngine.calculateRoutingMatrix();
					}
				} else if (model.model instanceof PointModel) {
					// we want points that are connected to ports, to not necessarily snap to grid
					// this stuff needs to be pixel perfect, dont touch it
					model.model.x = model.initialX + diagramModel.getGridPosition(amountX / amountZoom);
					model.model.y = model.initialY + diagramModel.getGridPosition(amountY / amountZoom);
				}
			});

			if (diagramEngine.isSmartRoutingEnabled()) {
				diagramEngine.calculateCanvasMatrix();
			}

			this.fireAction();
			if (!this.state.wasMoved) {
				this.setState({ wasMoved: true });
			} else {
				this.forceUpdate();
			}
		} else if (this.state.action instanceof MoveCanvasAction) {
			//translate the actual canvas
			if (this.props.allowCanvasTranslation) {
				diagramModel.setOffset(
					this.state.action.initialOffsetX + (Toolkit.getClientX(event) - this.state.action.mouseX),
					this.state.action.initialOffsetY + (Toolkit.getClientY(event) - this.state.action.mouseY)
				);
				this.fireAction();
				this.forceUpdate();
			}
		}
	}

	onKeyUp(event) {
		//delete all selected
		if (this.props.deleteKeys.indexOf(event.keyCode) !== -1) {
			_.forEach(this.props.diagramEngine.getDiagramModel().getSelectedItems(), element => {
				//only delete items which are not locked
				if (!this.props.diagramEngine.isModelLocked(element)) {
					element.remove();
				}
			});
			this.forceUpdate();
		}
	}

	onMouseUp(event) {
		var diagramEngine = this.props.diagramEngine;
		//are we going to connect a link to something?
		if (this.state.action instanceof MoveItemsAction) {
			var element = this.getMouseElement(event);
			_.forEach(this.state.action.selectionModels, model => {
				//only care about points connecting to things
				if (!(model.model instanceof PointModel)) {
					return;
				}
				if (element && element.model instanceof PortModel && !diagramEngine.isModelLocked(element.model)) {
					let link = model.model.getLink();
					if (link.getTargetPort() !== null) {
						//if this was a valid link already and we are adding a node in the middle, create 2 links from the original
						if (link.getTargetPort() !== element.model && link.getSourcePort() !== element.model) {
							const targetPort = link.getTargetPort();
							let newLink = link.clone({});
							newLink.setSourcePort(element.model);
							newLink.setTargetPort(targetPort);
							link.setTargetPort(element.model);
							targetPort.removeLink(link);
							newLink.removePointsBefore(newLink.getPoints()[link.getPointIndex(model.model)]);
							link.removePointsAfter(model.model);
							diagramEngine.getDiagramModel().addLink(newLink);
							//if we are connecting to the same target or source, remove tweener points
						} else if (link.getTargetPort() === element.model) {
							link.removePointsAfter(model.model);
						} else if (link.getSourcePort() === element.model) {
							link.removePointsBefore(model.model);
						}
					} else {
						if(link.getSourcePort().getID() !== element.model.getID()){
							// when touch end fire this mouse up, cannot find the e.touches
							link.setTargetPort(element.model);
						}
					}
					delete this.props.diagramEngine.linksThatHaveInitiallyRendered[link.getID()];
				}
			});

			//check for / remove any loose links in any models which have been moved
			if (!this.props.allowLooseLinks && this.state.wasMoved) {
				_.forEach(this.state.action.selectionModels, model => {
					//only care about points connecting to things
					if (!(model.model instanceof PointModel)) {
						return;
					}

					let selectedPoint: PointModel = model.model;
					let link: LinkModel = selectedPoint.getLink();
					if (link.getSourcePort() === null || link.getTargetPort() === null) {
						link.remove();
					}
				});
			}

			//remove any invalid links
			_.forEach(this.state.action.selectionModels, model => {
				//only care about points connecting to things
				if (!(model.model instanceof PointModel)) {
					return;
				}

				let link: LinkModel = model.model.getLink();
				let sourcePort: PortModel = link.getSourcePort();
				let targetPort: PortModel = link.getTargetPort();
				if (sourcePort !== null && targetPort !== null) {
					if (!sourcePort.canLinkToPort(targetPort)) {
						//link not allowed
						link.remove();
					} else if (
						_.some(
							_.values(targetPort.getLinks()),
							(l: LinkModel) =>
								l !== link && (l.getSourcePort() === sourcePort || l.getTargetPort() === sourcePort)
						)
					) {
						//link is a duplicate
						link.remove();
					}
				}
			});

			diagramEngine.clearRepaintEntities();
			this.stopFiringAction(!this.state.wasMoved);
		} else {
			diagramEngine.clearRepaintEntities();
			this.stopFiringAction();
		}
		this.state.document.removeEventListener("mousemove", this.onMouseMove);
		this.state.document.removeEventListener("mouseup", this.onMouseUp);
		this.state.document.removeEventListener("touchmove", this.onMouseMove);
		this.state.document.removeEventListener("touchend", this.onMouseUp);
	}

	onMouseDown(event, diagramEngine, diagramModel) {
		const clientX = Toolkit.getClientX(event);
		const clientY = Toolkit.getClientY(event);
		if (event.nativeEvent.which === 3) return;
		this.setState({ ...this.state, wasMoved: false });

		diagramEngine.clearRepaintEntities();
		var model = this.getMouseElement(event);
		//the canvas was selected
		if (model === null) {
			//is it a multiple selection
			if (event.shiftKey) {
				var relative = diagramEngine.getRelativePoint(clientX, clientY);
				this.startFiringAction(new SelectingAction(relative.x, relative.y));
			} else {
				//its a drag the canvas event
				diagramModel.clearSelection();
				this.startFiringAction(new MoveCanvasAction(clientX, clientY, diagramModel));
			}
		} else if (model.model instanceof PortModel) {
			//its a port element, we want to drag a link
			if (!this.props.diagramEngine.isModelLocked(model.model)) {
				var relative = diagramEngine.getRelativeMousePoint(event);
				var sourcePort = model.model;
				var link = sourcePort.createLinkModel();
				link.setSourcePort(sourcePort);

				if (link) {
					link.removeMiddlePoints();
					if (link.getSourcePort() !== sourcePort) {
						link.setSourcePort(sourcePort);
					}
					link.setTargetPort(null);

					link.getFirstPoint().updateLocation(relative);
					link.getLastPoint().updateLocation(relative);

					diagramModel.clearSelection();
					link.getLastPoint().setSelected(true);
					diagramModel.addLink(link);

					this.startFiringAction(
						new MoveItemsAction(clientX, clientY, diagramEngine)
					);
				}
			} else {
				diagramModel.clearSelection();
			}
		} else {
			//its some or other element, probably want to move it
			if (!event.shiftKey && !model.model.isSelected()) {
				diagramModel.clearSelection();
			}
			model.model.setSelected(true);
			this.startFiringAction(new MoveItemsAction(clientX, clientY, diagramEngine));
		}
		this.state.document.addEventListener("touchmove", this.onMouseMove);
		this.state.document.addEventListener("touchend", this.onMouseUp);
		this.state.document.addEventListener("mousemove", this.onMouseMove);
		this.state.document.addEventListener("mouseup", this.onMouseUp);
	}

	drawSelectionBox() {
		let dimensions = (this.state.action as SelectingAction).getBoxDimensions();
		return (
			<div
				className={this.bem("__selector")}
				style={{
					top: dimensions.top,
					left: dimensions.left,
					width: dimensions.width,
					height: dimensions.height
				}}
			/>
		);
	}

	render() {
		var diagramEngine = this.props.diagramEngine;
		diagramEngine.setMaxNumberPointsPerLink(this.props.maxNumberPointsPerLink);
		diagramEngine.setSmartRoutingStatus(this.props.smartRouting);
		var diagramModel = diagramEngine.getDiagramModel();

		return (
			<div
				{...this.getProps()}
				ref={ref => {
					if (ref) {
						this.props.diagramEngine.setCanvas(ref);
					}
				}}
				onWheel={event => {
					if (this.props.allowCanvasZoom) {
						event.preventDefault();
						event.stopPropagation();
						const oldZoomFactor = diagramModel.getZoomLevel() / 100;
						let scrollDelta = this.props.inverseZoom ? -event.deltaY : event.deltaY;
						//check if it is pinch gesture
						if (event.ctrlKey && scrollDelta % 1 !== 0) {
							/*Chrome and Firefox sends wheel event with deltaY that
                have fractional part, also `ctrlKey` prop of the event is true
                though ctrl isn't pressed
              */
							scrollDelta /= 3;
						} else {
							scrollDelta /= 60;
						}
						if (diagramModel.getZoomLevel() + scrollDelta > 10) {
							diagramModel.setZoomLevel(diagramModel.getZoomLevel() + scrollDelta);
						}

						const zoomFactor = diagramModel.getZoomLevel() / 100;

						const boundingRect = event.currentTarget.getBoundingClientRect();
						const clientWidth = boundingRect.width;
						const clientHeight = boundingRect.height;
						// compute difference between rect before and after scroll
						const widthDiff = clientWidth * zoomFactor - clientWidth * oldZoomFactor;
						const heightDiff = clientHeight * zoomFactor - clientHeight * oldZoomFactor;
						// compute mouse coords relative to canvas
						const clientX = Toolkit.getClientX(event) - boundingRect.left;
						const clientY = Toolkit.getClientY(event) - boundingRect.top;

						// compute width and height increment factor
						const xFactor = (clientX - diagramModel.getOffsetX()) / oldZoomFactor / clientWidth;
						const yFactor = (clientY - diagramModel.getOffsetY()) / oldZoomFactor / clientHeight;

						diagramModel.setOffset(
							diagramModel.getOffsetX() - widthDiff * xFactor,
							diagramModel.getOffsetY() - heightDiff * yFactor
						);

						diagramEngine.enableRepaintEntities([]);
						this.forceUpdate();
					}
				}}
				onTouchStart={event => this.onMouseDown(event, diagramEngine, diagramModel)}
				onMouseDown={event => this.onMouseDown(event, diagramEngine, diagramModel)}
			>
				{this.state.renderedNodes && (
					<LinkLayerWidget
						diagramEngine={diagramEngine}
						pointAdded={(point: PointModel, event) => {
							this.state.document.addEventListener("touchmove", this.onMouseMove);
							this.state.document.addEventListener("mousemove", this.onMouseMove);
							this.state.document.addEventListener("touchend", this.onMouseUp);
							this.state.document.addEventListener("mouseup", this.onMouseUp);
							event.stopPropagation();
							diagramModel.clearSelection(point);
							this.setState({
								action: new MoveItemsAction(Toolkit.getClientX(event), Toolkit.getClientY(event), diagramEngine)
							});
						}}
					/>
				)}
				<NodeLayerWidget diagramEngine={diagramEngine} />
				{this.state.action instanceof SelectingAction && this.drawSelectionBox()}
			</div>
		);
	}
}
