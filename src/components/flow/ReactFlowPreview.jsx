import { useCallback, useState, useEffect } from 'react';
import { ReactFlow, applyEdgeChanges, applyNodeChanges, Background, MiniMap, Controls, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../styles/workflow.css';
import CustomNode from './CustomNode';

const nodeTypes = {
    custom: CustomNode,
};

const initialNodes = [
    {
        id: '2',
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'custom',
        data: {
            label: 'Parsing',
            description: 'The workflow will be parsed quickly and safely in your browser',
            nodeType: 'code',
        },
        position: { x: 300, y: 250 },
    },
    {
        id: '3',
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'custom',
        data: {
            label: 'Preview',
            description: 'Finally you will see the simplified structure preview of your worflow here',
            nodeType: 'answer',
        },
        position: { x: 500, y: 400 },
    },
];

const initialEdges = [
    { id: 'e2-3', source: '2', target: '3', animated: true },
];

const ReactFlowPreview = () => {
    const [nodes, setNodes] = useState(initialNodes);
    const [edges, setEdges] = useState(initialEdges);

    const onNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes],
    );
    const onEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges],
    );
    const reactFlowInstance = useReactFlow();

    useEffect(() => {
        // Expose the update function to the global scope
        // window.updateReactFlow = (newNodes, newEdges) => {
        //     console.log('updateReactFlow called');
        //     setNodes(newNodes);
        //     setEdges(newEdges);
        //     console.log("Workflow Data Updated");
        //     // Fit the view to the graph
        //     reactFlowInstance.fitView(true);
        // };
        const updateFlowData = (newNodes, newEdges) => {
            console.log('updateReactFlow called');
            setNodes(newNodes);
            setEdges(newEdges);
            console.log("Workflow Data Updated");
            reactFlowInstance.fitView();
        };

        window.updateReactFlow = updateFlowData;

        const handleCustomEvent = (event) => {
            const { nodes, edges } = event.detail;
            updateFlowData(nodes, edges);
        };

        window.addEventListener('updateReactFlowData', handleCustomEvent);

        // Cleanup function
        return () => {
            delete window.updateReactFlow;
            window.removeEventListener('updateReactFlowData', handleCustomEvent);
        };
    }, []);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            zoomOnScroll={false}
            panOnDrag={true}
            className="bg-gray-100"
            nodeTypes={nodeTypes}
            minZoom={0.1}
            colorMode='system'
            fitView >
            <Background />
            <MiniMap pannable position='bottom-left' maskColor='rgb(240, 240, 250, 0.6)' />
            <Controls />
        </ReactFlow>
    );
};

// export default ReactFlowPreview;
// wrapping with ReactFlowProvider is done outside of the component
function FlowWithProvider(props) {
    return (
        <ReactFlowProvider>
            <ReactFlowPreview {...props} />
        </ReactFlowProvider>
    );
}

export default FlowWithProvider;